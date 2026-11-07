"""Parser tests: all use offline HTML from tests/fixtures, no network access."""
from __future__ import annotations

from pathlib import Path

from app.fetch import FetchResult
from app.parsers.generic import GenericParser
from app.parsers.github import GithubParser
from app.parsers.registry import get_parser
from app.parsers.video import VideoParser
from app.parsers.wechat import WechatParser

FIXTURES = Path(__file__).parent / "fixtures"


def make_fetch(name: str, url: str) -> FetchResult:
    text = (FIXTURES / name).read_text(encoding="utf-8")
    return FetchResult(
        url=url,
        final_url=url,
        status_code=200,
        headers={"content-type": "text/html; charset=utf-8"},
        text=text,
        raw=text.encode("utf-8"),
        truncated=False,
    )


def make_html_fetch(html: str, url: str) -> FetchResult:
    return FetchResult(
        url=url,
        final_url=url,
        status_code=200,
        headers={"content-type": "text/html"},
        text=html,
        raw=html.encode("utf-8"),
        truncated=False,
    )


# ---------------------------------------------------------------- generic

def test_generic_article_metadata_and_content():
    url = "https://blog.example.com/post/1"
    result = GenericParser().parse(make_fetch("generic_article.html", url))
    assert result.parse_status == "completed"
    assert result.error_code is None
    assert result.title == "使用 pgvector 构建语义搜索"
    assert result.author == "张三"
    assert result.published_at is not None
    assert result.published_at.isoformat().startswith("2024-03-01T02:00:00")  # UTC
    assert result.site_name == "示例博客"
    assert result.language == "zh-CN"
    assert "pgvector 扩展允许在数据库中存储向量" in result.plain_text
    assert result.content_markdown.startswith("#")  # trafilatura outputs markdown
    assert "https://example.com/images/cover.png" in result.images
    assert "https://github.com/pgvector/pgvector" in result.links


def test_generic_bs4_fallback_when_trafilatura_fails(monkeypatch):
    monkeypatch.setattr("app.parsers.generic.trafilatura.extract", lambda *a, **k: None)
    url = "https://blog.example.com/odd"
    result = GenericParser().parse(make_fetch("generic_no_article.html", url))
    assert result.parse_status == "completed"
    assert "深入理解任务调度系统" in result.plain_text
    assert "时间片轮转" in result.plain_text
    assert result.metadata["parser"] == "generic"


def test_generic_metadata_only_is_partial():
    html = ("<!doctype html><html><head><title>只有标题的页面</title>"
            "<meta name='description' content='描述文字'></head><body></body></html>")
    result = GenericParser().parse(make_html_fetch(html, "https://x.example.com/a"))
    assert result.parse_status == "partial"
    assert result.error_code == "CONTENT_NOT_FOUND"
    assert result.title == "只有标题的页面"
    assert result.plain_text is None


def test_generic_nothing_recognizable_is_failed():
    result = GenericParser().parse(make_html_fetch("<!doctype html><html><body></body></html>", "https://x.example.com/b"))
    assert result.parse_status == "failed"
    assert result.error_code == "CONTENT_NOT_FOUND"


# ---------------------------------------------------------------- wechat

def test_wechat_article_full_extraction():
    url = "https://mp.weixin.qq.com/s/AbCdEf"
    result = WechatParser().parse(make_fetch("wechat_article.html", url))
    assert result.parse_status == "completed"
    assert result.title == "深入理解任务调度系统"
    assert result.metadata["account"] == "示例公众号"
    assert result.author == "示例公众号"  # falls back to the official account name when js_author_name is empty
    assert result.published_at is not None
    assert result.site_name.startswith("微信公众号")
    # Body paragraphs are intact, and inline spans are no longer split apart
    assert "任务调度是操作系统的核心功能之一" in result.plain_text
    assert "本文介绍公平调度与优先级调度的区别" in result.plain_text
    # Images take data-src and are turned into absolute addresses; body links are kept
    assert result.images == ["https://mmbiz.qpic.cn/mmbiz_png/example/0?wx_fmt=png"]
    assert result.links == ["https://example.com/scheduler-guide"]


def test_wechat_structure_changed_returns_partial_not_raise():
    html = ("<html><head><title>文章标题 - 微信公众平台</title></head>"
            "<body><div class='page_container'>环境异常，请在微信中打开</div></body></html>")
    result = WechatParser().parse(make_html_fetch(html, "https://mp.weixin.qq.com/s/GhIjKl"))
    assert result.parse_status == "partial"
    assert result.error_code == "CONTENT_NOT_FOUND"
    assert result.title == "文章标题"  # the suffix is stripped
    assert result.plain_text is None


def test_wechat_garbage_html_returns_failed_without_raising():
    result = WechatParser().parse(make_html_fetch("plain text, no html at all", "https://mp.weixin.qq.com/s/QwE"))
    assert result.parse_status == "failed"
    assert result.error_code == "CONTENT_NOT_FOUND"


def test_wechat_ct_epoch_fallback():
    html = ("<html><head><title>时间戳文章 - 微信公众平台</title></head>"
            "<body><h1 id='activity-name'>时间戳文章</h1>"
            "<div id='js_content'><p>正文内容足够长，这是一篇关于任务调度的文章。</p></div>"
            "<script>var ct = \"1716168600\";</script></body></html>")
    result = WechatParser().parse(make_html_fetch(html, "https://mp.weixin.qq.com/s/ZxC"))
    assert result.parse_status == "completed"
    assert result.published_at is not None
    assert result.published_at.timestamp() == 1716168600


# ---------------------------------------------------------------- github

def test_github_repo_page():
    url = "https://github.com/pgvector/pgvector"
    result = GithubParser().parse(make_fetch("github_repo.html", url))
    assert result.parse_status == "completed"
    assert result.title.startswith("pgvector/pgvector:")
    assert result.author == "pgvector"
    assert result.site_name == "GitHub"
    assert "open-source vector similarity search" in (result.description or "").lower()
    # README converted to markdown: headings, lists, code blocks
    assert "# About" in result.content_markdown
    assert "- Exact and approximate (HNSW) nearest neighbor search" in result.content_markdown
    assert "CREATE EXTENSION vector;" in result.content_markdown
    assert "Scales to millions of rows" in result.plain_text
    assert result.metadata["stars"] == 12500
    assert result.metadata["forks"] == 1042
    assert result.metadata["language"] == "C"


def test_github_no_readme_is_partial():
    html = ("<html><head><title>owner/repo: empty repo</title>"
            "<meta property='og:title' content='owner/repo: empty repo'>"
            "<meta property='og:description' content='empty'></head>"
            "<body><h1>owner/repo</h1></body></html>")
    result = GithubParser().parse(make_html_fetch(html, "https://github.com/owner/repo"))
    assert result.parse_status == "partial"
    assert result.error_code == "CONTENT_NOT_FOUND"
    assert result.content_markdown is None


# ---------------------------------------------------------------- video

def test_youtube_metadata_only_no_fabricated_content():
    url = "https://www.youtube.com/watch?v=abc123"
    result = VideoParser().parse(make_fetch("youtube_og.html", url))
    assert result.parse_status == "partial"
    assert result.title == "向量数据库入门完整教程"
    assert result.author == "Tech频道"
    assert result.published_at is not None
    assert result.site_name == "YouTube"
    assert result.metadata["duration_seconds"] == 754
    assert result.metadata["has_transcript"] is False
    # No transcript capability: the body must not be fabricated
    assert result.plain_text is None
    assert result.content_markdown is None


# ---------------------------------------------------------------- registry

def test_registry_priority_and_fallback():
    assert isinstance(get_parser("https://mp.weixin.qq.com/s/x", "wechat"), WechatParser)
    assert isinstance(get_parser("https://github.com/a/b", "github"), GithubParser)
    assert isinstance(get_parser("https://www.youtube.com/watch?v=1", "youtube"), VideoParser)
    assert isinstance(get_parser("https://www.bilibili.com/video/BV1", "bilibili"), VideoParser)
    assert isinstance(get_parser("https://x.com/user/status/1", "twitter"), VideoParser)
    generic = get_parser("https://blog.example.com/any", "web")
    assert isinstance(generic, GenericParser)
