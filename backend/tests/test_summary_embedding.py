"""Summaries and embeddings: authenticity of the local algorithms, determinism, and error mapping."""
from __future__ import annotations

import json
import math
from types import SimpleNamespace

import httpx
import pytest

from app.ai.embedding import (
    EmbeddingProviderError,
    LocalHashEmbeddingProvider,
    OpenAIEmbeddingProvider,
    get_embedding_provider,
)
from app.ai.summary import (
    ExtractiveSummaryProvider,
    OpenAISummaryProvider,
    SummaryProviderError,
    get_summary_provider,
)
from app.config import Settings, validate_settings

ZH_TEXT = (
    "任务调度是操作系统的核心功能之一，决定了哪些进程在什么时候获得 CPU。\n\n"
    "公平调度与优先级调度的区别在于是否保证每个任务获得相等的 CPU 时间。\n\n"
    "时间片轮转是一种常见的公平调度算法，调度器按固定时间片切换任务。\n\n"
    "Linux 使用完全公平调度器 CFS 来处理普通任务的调度问题。"
)

EN_TEXT = (
    "Task scheduling is a core function of operating systems. "
    "The scheduler decides which process runs at any given time. "
    "Fair scheduling guarantees that every task receives an equal share of CPU time. "
    "Priority scheduling runs high priority tasks first. "
    "Round robin is a fair scheduling algorithm that uses time slices."
)


# ---------------------------------------------------------------- summary: extractive

def test_extractive_short_summary_is_from_original():
    result = ExtractiveSummaryProvider().summarize("深入理解任务调度系统", ZH_TEXT)
    short = result.summary_short.rstrip("…")
    assert short and short in ZH_TEXT  # no fabrication: the short summary must be a sentence from the original
    assert len(result.summary_short) <= 140
    assert result.summary_long and len(result.summary_long) <= 600


def test_extractive_keywords_and_topics_come_from_text():
    result = ExtractiveSummaryProvider().summarize("深入理解任务调度系统", ZH_TEXT)
    assert result.keywords
    lowered = ZH_TEXT.lower()
    for keyword in result.keywords:
        assert keyword in lowered, keyword  # every keyword really does appear in the original
    assert "调度" in result.keywords
    assert result.topics
    for topic in result.topics:
        assert topic in lowered, topic


def test_extractive_english_also_works():
    result = ExtractiveSummaryProvider().summarize("Scheduling", EN_TEXT)
    lowered = EN_TEXT.lower()
    assert result.summary_short.rstrip("…").lower() in lowered
    assert any("scheduling" in k for k in result.keywords)
    assert all(k in lowered for k in result.keywords)


def test_extractive_deterministic():
    provider = ExtractiveSummaryProvider()
    assert provider.summarize("t", ZH_TEXT) == provider.summarize("t", ZH_TEXT)


def test_extractive_empty_text_falls_back_to_title():
    result = ExtractiveSummaryProvider().summarize("只有标题", "")
    assert result.summary_short == "只有标题"
    assert result.keywords == []


# ---------------------------------------------------------------- summary: OpenAI-compatible

def _summary_client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_openai_summary_parses_json_payload():
    payload = {"summary_short": "短摘要", "summary_long": "长摘要",
               "keywords": ["调度"], "topics": ["操作系统"]}

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        assert body["model"] == "test-model"
        assert "待分析" in body["messages"][0]["content"]  # the prompt treats the body as data
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(payload, ensure_ascii=False)}}]})

    settings = SimpleNamespace(ai_api_key="k", ai_base_url="https://api.test/v1", ai_model="test-model")
    provider = OpenAISummaryProvider(settings, client=_summary_client(handler))
    result = provider.summarize("标题", "正文")
    assert result.summary_short == "短摘要"
    assert result.keywords == ["调度"]


def test_openai_summary_uses_custom_path_auth_and_extra_headers():
    seen: dict[str, str | None] = {}
    payload = {"summary_short": "短摘要", "summary_long": "长摘要", "keywords": [], "topics": []}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers.get("authorization")
        seen["api_key"] = request.headers.get("x-api-key")
        seen["org"] = request.headers.get("x-org")
        seen["user_agent"] = request.headers.get("user-agent")
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(payload, ensure_ascii=False)}}]},
        )

    settings = SimpleNamespace(
        ai_api_key="secret",
        ai_base_url="https://api.test/v1/",
        ai_model="test-model",
        ai_chat_path="custom/chat",
        ai_auth_header="X-Api-Key",
        ai_auth_prefix="",  # send the key directly, without adding Bearer
        ai_extra_headers='{"X-Org": "trovia"}',
    )
    provider = OpenAISummaryProvider(settings, client=_summary_client(handler))
    provider.summarize("标题", "正文")
    assert seen["url"] == "https://api.test/v1/custom/chat"
    assert seen["api_key"] == "secret"
    assert seen["authorization"] is None
    assert seen["org"] == "trovia"
    assert seen["user_agent"] == "trovia/0.1"


def test_openai_summary_json_mode_can_be_disabled():
    bodies: list[dict] = []
    payload = {"summary_short": "短摘要", "summary_long": "长摘要", "keywords": [], "topics": []}

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content.decode()))
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(payload, ensure_ascii=False)}}]},
        )

    settings = SimpleNamespace(
        ai_api_key="",  # a local service may go without a key
        ai_base_url="http://localhost:11434/v1",
        ai_model="local-model",
        ai_json_mode=False,
    )
    provider = OpenAISummaryProvider(settings, client=_summary_client(handler))
    provider.summarize("标题", "正文")
    assert "response_format" not in bodies[0]
    assert bodies[0]["model"] == "local-model"


def test_openai_summary_rejects_invalid_extra_headers():
    settings = SimpleNamespace(
        ai_api_key="k",
        ai_base_url="https://api.test/v1",
        ai_model="m",
        ai_extra_headers="{not json",
    )
    with pytest.raises(RuntimeError):
        OpenAISummaryProvider(settings)


def test_openai_summary_maps_http_error_to_ai_provider_error():
    settings = SimpleNamespace(ai_api_key="k", ai_base_url="https://api.test/v1", ai_model="m")
    provider = OpenAISummaryProvider(settings, client=_summary_client(lambda r: httpx.Response(400, json={})))
    with pytest.raises(SummaryProviderError) as exc:
        provider.summarize("t", "正文")
    assert exc.value.code == "AI_PROVIDER_ERROR"


def test_openai_summary_retries_server_errors_then_raises():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(500, json={})

    settings = SimpleNamespace(ai_api_key="k", ai_base_url="https://api.test/v1", ai_model="m")
    provider = OpenAISummaryProvider(settings, client=_summary_client(handler))
    with pytest.raises(SummaryProviderError) as exc:
        provider.summarize("t", "正文")
    assert exc.value.code == "AI_PROVIDER_ERROR"
    assert len(calls) >= 2  # it did retry, a bounded number of times


def test_get_summary_provider_factory():
    assert isinstance(get_summary_provider(Settings(ai_provider="extractive")), ExtractiveSummaryProvider)
    with pytest.raises(RuntimeError):
        get_summary_provider(SimpleNamespace(ai_provider="bogus", ai_api_key=""))
    with pytest.raises(RuntimeError):
        # a compatible service must have a base URL and a model; the key may be absent
        get_summary_provider(SimpleNamespace(ai_provider="openai-compatible", ai_base_url="", ai_model="m"))


def test_get_summary_provider_accepts_compatible_without_api_key():
    settings = SimpleNamespace(
        ai_provider="openai-compatible",
        ai_api_key="",
        ai_base_url="http://localhost:11434/v1",
        ai_model="llama3",
    )
    assert isinstance(get_summary_provider(settings), OpenAISummaryProvider)


# ---------------------------------------------------------------- embedding: local hashing

def test_local_embedding_dim_and_normalization():
    provider = LocalHashEmbeddingProvider(1536)
    vector = provider.embed(["任务调度系统的设计与实现"])[0]
    assert len(vector) == 1536
    assert math.isclose(math.sqrt(sum(v * v for v in vector)), 1.0, rel_tol=1e-9)


def test_local_embedding_deterministic():
    provider = LocalHashEmbeddingProvider(1536)
    assert provider.embed(["hello world 任务调度"]) == provider.embed(["hello world 任务调度"])
    assert provider.model_name == "local-hash-1536"


def test_local_embedding_semantics_via_shared_tokens():
    provider = LocalHashEmbeddingProvider(1536)
    a, b, c = provider.embed([
        "任务调度系统的设计与实现",
        "任务调度系统原理详解",
        "今天天气很好适合出门郊游",
    ])

    def cosine(x, y):
        return sum(i * j for i, j in zip(x, y))

    assert cosine(a, b) > cosine(a, c)  # shared tokens → semantically closer
    assert cosine(a, b) > 0.2


def test_local_embedding_empty_string_zero_vector():
    vector = LocalHashEmbeddingProvider(16).embed([""])[0]
    assert vector == [0.0] * 16


# ---------------------------------------------------------------- embedding: OpenAI-compatible

def _embed_settings(dim=8):
    return SimpleNamespace(embedding_dim=dim, embedding_model="test-embed",
                           embedding_api_key="k", embedding_base_url="https://api.test/v1")


def test_openai_embedding_batch_success():
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        n = len(body["input"])
        return httpx.Response(200, json={"data": [{"index": i, "embedding": [0.5] * 8} for i in range(n)]})

    provider = OpenAIEmbeddingProvider(_embed_settings(), client=httpx.Client(transport=httpx.MockTransport(handler)))
    vectors = provider.embed(["a", "b"])
    assert len(vectors) == 2
    assert all(len(v) == 8 for v in vectors)


def test_openai_embedding_uses_custom_path_auth_and_headers():
    seen: dict[str, str | None] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers.get("authorization")
        seen["api_key"] = request.headers.get("x-api-key")
        seen["org"] = request.headers.get("x-org")
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.5] * 8}]})

    settings = _embed_settings()
    settings.embedding_api_key = "secret"
    settings.embedding_base_url = "https://api.test/v1/"
    settings.embedding_path = "custom/embeddings"
    settings.embedding_auth_header = "X-Api-Key"
    settings.embedding_auth_prefix = "Token"
    settings.embedding_extra_headers = '{"X-Org": "trovia"}'
    provider = OpenAIEmbeddingProvider(
        settings, client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    provider.embed(["a"])
    assert seen["url"] == "https://api.test/v1/custom/embeddings"
    assert seen["api_key"] == "Token secret"
    assert seen["authorization"] is None
    assert seen["org"] == "trovia"


def test_openai_embedding_without_api_key_sends_no_auth_header():
    seen: dict[str, str | None] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers.get("authorization")
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.5] * 8}]})

    settings = _embed_settings()
    settings.embedding_api_key = ""
    provider = OpenAIEmbeddingProvider(
        settings, client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    provider.embed(["a"])
    assert seen["authorization"] is None


def test_get_embedding_provider_accepts_openai_compatible_alias():
    settings = SimpleNamespace(
        embedding_provider="openai-compatible",
        embedding_dim=8,
        embedding_model="test-embed",
        embedding_base_url="http://localhost:11434/v1",
    )
    provider = get_embedding_provider(settings)
    assert isinstance(provider, OpenAIEmbeddingProvider)
    assert provider.dim == 8


def test_openai_embedding_http_error_maps_to_embedding_error():
    provider = OpenAIEmbeddingProvider(
        _embed_settings(), client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(503, json={})))
    )
    with pytest.raises(EmbeddingProviderError) as exc:
        provider.embed(["a"])
    assert exc.value.code == "EMBEDDING_ERROR"


def test_openai_embedding_dim_mismatch_raises_runtime_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.5] * 4}]})

    provider = OpenAIEmbeddingProvider(_embed_settings(dim=8), client=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(RuntimeError):
        provider.embed(["a"])


def test_get_embedding_provider_factory():
    settings = Settings()  # conftest env vars: local + 1536
    provider = get_embedding_provider(settings)
    assert isinstance(provider, LocalHashEmbeddingProvider)
    assert provider.dim == settings.embedding_dim == 1536
    with pytest.raises(RuntimeError):
        get_embedding_provider(SimpleNamespace(embedding_provider="bogus", embedding_dim=1536))


# ---------------------------------------------------------------- settings validation

def test_validate_settings_accepts_compatible_without_key():
    settings = Settings(
        ai_provider="openai-compatible",
        ai_base_url="http://localhost:11434/v1",
        ai_model="qwen2.5:7b",
        ai_extra_headers='{"X-Org": "trovia"}',
        ai_json_mode=False,
    )
    validate_settings(settings)


def test_validate_settings_rejects_invalid_extra_headers():
    settings = Settings(
        ai_provider="openai-compatible",
        ai_base_url="http://localhost:11434/v1",
        ai_model="m",
        ai_extra_headers="{bad json",
    )
    with pytest.raises(RuntimeError):
        validate_settings(settings)


def test_validate_settings_requires_base_url_for_compatible():
    settings = Settings(ai_provider="openai-compatible", ai_base_url="", ai_model="m")
    with pytest.raises(RuntimeError):
        validate_settings(settings)
