"""URL 规范化、去重与来源识别。"""
from __future__ import annotations

import pytest

from app.errors import ApiError
from app.services.url_utils import detect_source_type, extract_first_url, normalize_url


def test_strips_tracking_params_and_sorts_query():
    norm = normalize_url(
        "https://Example.com/Post/1?b=2&utm_source=tw&a=1&fbclid=abc#section"
    )
    assert norm.canonical == "https://example.com/Post/1?a=1&b=2"
    assert norm.host == "example.com"
    assert norm.scheme == "https"
    assert norm.original.startswith("https://Example.com")


def test_equivalent_urls_share_hash():
    first = normalize_url("https://example.com/a?x=1&y=2#frag")
    second = normalize_url("https://example.com/a?y=2&x=1")
    third = normalize_url("http://example.com:80/a?x=1&y=2")
    assert first.url_hash == second.url_hash
    assert third.url_hash != first.url_hash  # the scheme is part of content identity, so do not merge


def test_drops_default_port_and_trailing_slash():
    norm = normalize_url("https://example.com:443/path/")
    assert norm.canonical == "https://example.com/path"
    root = normalize_url("https://example.com/")
    assert root.canonical == "https://example.com/"
    assert root.url_hash != norm.url_hash


def test_keeps_content_identifying_params():
    norm = normalize_url("https://example.com/watch?v=abc123&page=2")
    assert "v=abc123" in norm.canonical
    assert "page=2" in norm.canonical


def test_extracts_url_from_share_text():
    text = "分享一篇好文：用 pgvector 做语义搜索 https://Example.com/post/1?utm_source=share 。值得一读。"
    assert extract_first_url(text) == "https://Example.com/post/1?utm_source=share"
    norm = normalize_url(text)
    assert norm.original == "https://Example.com/post/1?utm_source=share"
    assert norm.canonical == "https://example.com/post/1"


def test_extract_first_url_ignores_text_without_http_link():
    assert extract_first_url("只有一句普通分享文字") is None
    assert extract_first_url("ftp://example.com/file") is None


def test_extract_first_url_trims_wrapping_parenthesis_only():
    assert extract_first_url("见 https://example.com/a_(b) 。") == "https://example.com/a_(b)"
    assert extract_first_url("[链接](https://example.com/a)") == "https://example.com/a"


@pytest.mark.parametrize(
    "bad",
    ["", "   ", "not-a-url", "ftp://example.com/x", "javascript:alert(1)", "file:///etc/passwd",
     "https://user:pass@example.com/x", "https:///nohost"],
)
def test_rejects_invalid_urls(bad):
    with pytest.raises(ApiError) as exc:
        normalize_url(bad)
    assert exc.value.code == "INVALID_URL"


@pytest.mark.parametrize(
    "host,expected",
    [
        ("mp.weixin.qq.com", "wechat"),
        ("github.com", "github"),
        ("www.github.com", "github"),
        ("youtube.com", "youtube"),
        ("youtu.be", "youtube"),
        ("www.bilibili.com", "bilibili"),
        ("x.com", "twitter"),
        ("news.ycombinator.com", "web"),
    ],
)
def test_detect_source_type(host, expected):
    assert detect_source_type(host) == expected


def test_source_type_recorded_on_normalized_url():
    assert normalize_url("https://mp.weixin.qq.com/s/AbCdEf").source_type == "wechat"
    assert normalize_url("https://github.com/pgvector/pgvector").source_type == "github"
