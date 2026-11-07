"""SSRF protection: address blocklist, port restrictions, per-hop redirect validation, fetch limits."""
from __future__ import annotations

import httpx
import pytest

from app.errors import FetchError
from app.fetch import safe_fetch, validate_ssrf

PORTS = {80, 443, 8080, 8443}


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost/admin",
        "http://127.0.0.1:8080/",
        "http://10.0.0.5/internal",
        "http://192.168.1.1/router",
        "http://172.16.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]:80/",
        "http://[fd00:ec2::254]/",
        "http://metadata.google.internal/computeMetadata/v1/",
        "http://example.com:22/",
        "http://foo.local/",
        "http://intranet.internal/",
    ],
)
def test_blocks_unsafe_targets(url):
    with pytest.raises(FetchError) as exc:
        validate_ssrf(url, PORTS)
    assert exc.value.code in {"FETCH_BLOCKED", "INVALID_URL"}


def test_allows_public_literal_ip():
    validate_ssrf("https://93.184.216.34/doc", PORTS)  # passing means it did not raise


def test_blocks_dns_resolving_to_private_ip(monkeypatch):
    monkeypatch.setattr(
        "app.fetch.socket.getaddrinfo",
        lambda host, port, **kw: [(2, 1, 6, "", ("192.168.0.10", port))],
    )
    with pytest.raises(FetchError) as exc:
        validate_ssrf("https://evil.example.com/", PORTS)
    assert exc.value.code == "FETCH_BLOCKED"


def test_dns_failure_is_fetch_error(monkeypatch):
    import socket as _socket

    def _fail(*args, **kwargs):
        raise _socket.gaierror("nope")

    monkeypatch.setattr("app.fetch.socket.getaddrinfo", _fail)
    with pytest.raises(FetchError) as exc:
        validate_ssrf("https://doesnotexist.example/", PORTS)
    assert exc.value.code == "FETCH_ERROR"


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _public_dns(monkeypatch, ip="93.184.216.34"):
    monkeypatch.setattr(
        "app.fetch.socket.getaddrinfo",
        lambda host, port, **kw: [(2, 1, 6, "", (ip, port))],
    )


def test_fetches_and_decodes_body(monkeypatch):
    _public_dns(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html><body>正文内容</body></html>")

    with _client(handler) as client:
        result = safe_fetch("https://example.com/a", client=client, allowed_ports=PORTS)
    assert result.status_code == 200
    assert "正文内容" in result.text
    assert result.truncated is False


def test_redirect_to_internal_target_is_blocked(monkeypatch):
    _public_dns(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            302, headers={"location": "http://169.254.169.254/latest/meta-data/"}
        )

    with _client(handler) as client:
        with pytest.raises(FetchError) as exc:
            safe_fetch("https://example.com/a", client=client, allowed_ports=PORTS)
    assert exc.value.code == "FETCH_BLOCKED"


def test_too_many_redirects(monkeypatch):
    _public_dns(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": f"https://example.com{request.url.path}x"})

    with _client(handler) as client:
        with pytest.raises(FetchError) as exc:
            safe_fetch("https://example.com/r", client=client, allowed_ports=PORTS,
                       max_redirects=3)
    assert exc.value.code == "FETCH_BLOCKED"


def test_404_maps_to_content_not_found(monkeypatch):
    _public_dns(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="gone")

    with _client(handler) as client:
        with pytest.raises(FetchError) as exc:
            safe_fetch("https://example.com/gone", client=client, allowed_ports=PORTS)
    assert exc.value.code == "CONTENT_NOT_FOUND"


def test_403_maps_to_login_required(monkeypatch):
    _public_dns(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="login")

    with _client(handler) as client:
        with pytest.raises(FetchError) as exc:
            safe_fetch("https://example.com/private", client=client, allowed_ports=PORTS)
    assert exc.value.code == "FETCH_BLOCKED"


def test_body_size_limit(monkeypatch):
    _public_dns(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 5000)

    with _client(handler) as client:
        result = safe_fetch(
            "https://example.com/big", client=client, allowed_ports=PORTS, max_bytes=1000
        )
    assert result.truncated is True
    assert len(result.raw) == 1000
