"""Embedding Provider: OpenAI-compatible API + local deterministic feature-hashing vectors."""
from __future__ import annotations

import hashlib
import math
import re
from collections import Counter
from typing import Protocol

import httpx

from app.ai.openai_compat import (
    build_headers,
    build_url,
    is_openai_compatible,
    require_openai_settings,
)
from app.logging import get_logger

logger = get_logger("trovia.ai.embedding")

EMBEDDING_BATCH_SIZE = 64


class EmbeddingProviderError(Exception):
    """The embedding call failed; carries the contract error code (EMBEDDING_ERROR by default)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class EmbeddingProvider(Protocol):
    dim: int
    model_name: str

    def embed(self, texts: list[str]) -> list[list[float]]: ...


_WORD_RE = re.compile(r"[A-Za-z0-9_]+")
_CJK_RUN_RE = re.compile(r"[一-鿿㐀-䶿]+")


def tokenize_text(text: str) -> list[str]:
    """Latin letters/digits split by word (lowercased), Chinese by character + adjacent bigrams. Deterministic, no external dependencies."""
    if not text:
        return []
    tokens = [word.lower() for word in _WORD_RE.findall(text) if len(word) >= 2]
    for run in _CJK_RUN_RE.findall(text):
        tokens.extend(run)  # single characters
        for i in range(len(run) - 1):
            tokens.append(run[i : i + 2])  # adjacent bigrams
    return tokens


class LocalHashEmbeddingProvider:
    """Feature hashing vector: the same input gives the same output, and semantic neighbours rely on shared tokens.

    tokenize → sha1 hash into dim dimensions (signed, to remove clustering bias) → log-weighted term frequency → L2 normalization.
    """

    name = "local"

    def __init__(self, dim: int = 1536):
        if dim <= 0:
            raise RuntimeError(f"Embedding 维度必须为正整数，收到 {dim}")
        self.dim = dim
        self.model_name = f"local-hash-{dim}"

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(text or "") for text in texts]

    def _embed_one(self, text: str) -> list[float]:
        vector = [0.0] * self.dim
        for token, tf in Counter(tokenize_text(text)).items():
            digest = hashlib.sha1(token.encode("utf-8")).digest()
            index = int.from_bytes(digest[:8], "big") % self.dim
            sign = 1.0 if digest[8] & 1 else -1.0
            vector[index] += sign * (1.0 + math.log(tf))
        norm = math.sqrt(sum(value * value for value in vector))
        if norm > 0:
            vector = [value / norm for value in vector]
        return vector


class OpenAIEmbeddingProvider:
    """Any OpenAI-compatible /embeddings endpoint, called in batches; a dimension mismatch raises RuntimeError.

    Shares the same compatibility settings as summarization: base URL, path, auth header and extra request headers are all configurable.
    """

    name = "openai-compatible"

    def __init__(self, settings, *, client: httpx.Client | None = None):
        self.dim = settings.embedding_dim
        self.model_name = settings.embedding_model
        self._url = build_url(
            getattr(settings, "embedding_base_url", ""),
            getattr(settings, "embedding_path", "/embeddings"),
        )
        self._headers = build_headers(
            api_key=getattr(settings, "embedding_api_key", ""),
            auth_header=getattr(settings, "embedding_auth_header", "Authorization"),
            auth_prefix=getattr(settings, "embedding_auth_prefix", "Bearer"),
            extra_headers=getattr(settings, "embedding_extra_headers", "{}"),
        )
        timeout = float(getattr(settings, "embedding_timeout_seconds", 60.0))
        self._client = client or httpx.Client(timeout=timeout, trust_env=False)

    def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(texts), EMBEDDING_BATCH_SIZE):
            batch = texts[start : start + EMBEDDING_BATCH_SIZE]
            vectors.extend(self._embed_batch(batch))
        return vectors

    def _embed_batch(self, batch: list[str]) -> list[list[float]]:
        try:
            response = self._client.post(
                self._url,
                json={"model": self.model_name, "input": batch},
                headers=self._headers,
            )
        except httpx.HTTPError as exc:
            raise EmbeddingProviderError(
                "EMBEDDING_ERROR", f"Embedding 服务请求失败：{exc.__class__.__name__}"
            ) from exc
        if response.status_code != 200:
            raise EmbeddingProviderError(
                "EMBEDDING_ERROR", f"Embedding 服务返回状态码 {response.status_code}。"
            )
        try:
            data = sorted(response.json()["data"], key=lambda item: item["index"])
            vectors = [item["embedding"] for item in data]
        except (ValueError, KeyError, TypeError) as exc:
            raise EmbeddingProviderError(
                "EMBEDDING_ERROR", "Embedding 服务返回了无法解析的数据。"
            ) from exc
        if len(vectors) != len(batch):
            raise EmbeddingProviderError(
                "EMBEDDING_ERROR",
                f"Embedding 服务返回数量不匹配：请求 {len(batch)}，返回 {len(vectors)}。",
            )
        for vector in vectors:
            if len(vector) != self.dim:
                raise RuntimeError(
                    f"Embedding 维度不匹配：provider={self.dim} 返回={len(vector)}"
                )
        return vectors


def get_embedding_provider(settings) -> EmbeddingProvider:
    """Factory: openai / openai-compatible | local; a provider whose dimension disagrees raises RuntimeError."""
    if is_openai_compatible(getattr(settings, "embedding_provider", "")):
        require_openai_settings(
            base_url=getattr(settings, "embedding_base_url", ""),
            model=getattr(settings, "embedding_model", ""),
            base_var="EMBEDDING_BASE_URL",
            model_var="EMBEDDING_MODEL",
        )
        provider: EmbeddingProvider = OpenAIEmbeddingProvider(settings)
    elif settings.embedding_provider == "local":
        provider = LocalHashEmbeddingProvider(settings.embedding_dim)
    else:
        raise RuntimeError(f"不支持的 EMBEDDING_PROVIDER: {settings.embedding_provider}")
    if provider.dim != settings.embedding_dim:
        raise RuntimeError(
            f"Embedding 维度不匹配: provider={provider.dim} schema={settings.embedding_dim}"
        )
    return provider
