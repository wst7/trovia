"""Web fetching behind SSRF protection: the target is re-validated on every request and on every redirect hop."""
from __future__ import annotations

import ipaddress
import re
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import httpx

from app.config import get_settings
from app.errors import ApiError, FetchError
from app.logging import get_logger

logger = get_logger("trovia.fetch")

DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 Xunji/0.1 (+personal link recall)"
)
REDIRECT_STATUSES = {301, 302, 303, 307, 308}
BLOCKED_HOST_SUFFIXES = (
    ".localhost",
    ".local",
    ".internal",
    ".home.arpa",
    ".localdomain",
)
BLOCKED_HOSTS = {"localhost", "localhost.localdomain", "metadata.google.internal"}
# Cloud metadata and special-purpose addresses
BLOCKED_NETWORKS = [
    ipaddress.ip_network("169.254.0.0/16"),  # link-local + AWS/GCP/Azure metadata
    ipaddress.ip_network("100.64.0.0/10"),  # CGNAT
    ipaddress.ip_network("198.18.0.0/15"),  # benchmark
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("fd00:ec2::254/128"),  # AWS IMDS v6
    ipaddress.ip_network("fec0::/10"),
]
CHARSET_RE = re.compile(rb"""charset\s*=\s*["']?([A-Za-z0-9_.-]+)""", re.I)
META_CHARSET_RE = re.compile(rb"""<meta[^>]+charset\s*=\s*["']?([A-Za-z0-9_.-]+)""", re.I)


@dataclass
class FetchResult:
    url: str
    final_url: str
    status_code: int
    headers: dict[str, str]
    text: str
    raw: bytes
    truncated: bool


def _blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified:
        return True
    if ip.is_private or ip.is_reserved:
        return True
    return any(ip in net for net in BLOCKED_NETWORKS)


def validate_ssrf(url: str, allowed_ports: set[int] | None = None) -> None:
    """The request is allowed only once scheme, host and all DNS resolution results have passed."""
    settings = get_settings()
    ports = allowed_ports if allowed_ports is not None else settings.allowed_ports
    try:
        parts = urlsplit(url)
    except ValueError as exc:
        raise FetchError("INVALID_URL", "链接无法解析。") from exc
    scheme = parts.scheme.lower()
    if scheme not in {"http", "https"}:
        raise ApiError("FETCH_BLOCKED", "只允许抓取 HTTP 或 HTTPS 链接。", 400)
    host = (parts.hostname or "").lower()
    if not host:
        raise FetchError("INVALID_URL", "链接缺少主机名。")
    if host in BLOCKED_HOSTS or host.endswith(BLOCKED_HOST_SUFFIXES):
        raise FetchError("FETCH_BLOCKED", "该地址不允许被抓取。")
    try:
        port = parts.port or (443 if scheme == "https" else 80)
    except ValueError as exc:
        raise FetchError("INVALID_URL", "链接端口不合法。") from exc
    if port not in ports:
        raise FetchError("FETCH_BLOCKED", f"不允许访问端口 {port}。")

    # Literal IPs are validated directly; a domain is resolved first and then every resolved result is validated (the first gate against DNS rebinding)
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if _blocked_ip(literal):
            raise FetchError("FETCH_BLOCKED", "该地址不允许被抓取。")
        return

    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise FetchError("FETCH_ERROR", f"无法解析域名 {host}。") from exc
    addresses = {info[4][0] for info in infos}
    if not addresses:
        raise FetchError("FETCH_ERROR", f"无法解析域名 {host}。")
    for address in addresses:
        try:
            ip = ipaddress.ip_address(address)
        except ValueError as exc:
            raise FetchError("FETCH_BLOCKED", "域名解析结果异常。") from exc
        if _blocked_ip(ip):
            logger.warning("ssrf_blocked", extra={"host": host, "ip": address})
            raise FetchError("FETCH_BLOCKED", "目标地址指向受限网络，已阻止访问。")


def _decode(raw: bytes, content_type: str) -> str:
    charset = None
    match = re.search(r"charset=([^;\s]+)", content_type or "", re.I)
    if match:
        charset = match.group(1).strip("\"'")
    if not charset:
        head = raw[:8192]
        meta = META_CHARSET_RE.search(head) or CHARSET_RE.search(head)
        if meta:
            charset = meta.group(1).decode("ascii", "ignore")
    for candidate in ([charset] if charset else []) + ["utf-8", "gb18030"]:
        if not candidate:
            continue
        try:
            return raw.decode(candidate)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", errors="replace")


def safe_fetch(
    url: str,
    *,
    timeout: float | None = None,
    max_bytes: int | None = None,
    max_redirects: int | None = None,
    allowed_ports: set[int] | None = None,
    client: httpx.Client | None = None,
) -> FetchResult:
    settings = get_settings()
    timeout = timeout if timeout is not None else settings.fetch_timeout_seconds
    max_bytes = max_bytes if max_bytes is not None else settings.fetch_max_bytes
    max_redirects = max_redirects if max_redirects is not None else settings.fetch_max_redirects

    current = url
    owns_client = client is None
    client = client or httpx.Client(
        timeout=httpx.Timeout(timeout),
        follow_redirects=False,
        headers={"User-Agent": DEFAULT_UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"},
        trust_env=False,
    )
    try:
        for hop in range(max_redirects + 1):
            validate_ssrf(current, allowed_ports)
            try:
                with client.stream("GET", current) as response:
                    if response.status_code in REDIRECT_STATUSES:
                        location = response.headers.get("location")
                        if not location:
                            raise FetchError("FETCH_ERROR", "重定向缺少目标地址。")
                        current = urljoin(current, location)
                        continue
                    if response.status_code in {404, 410}:
                        raise FetchError("CONTENT_NOT_FOUND", "页面不存在或已被删除。")
                    if response.status_code in {401, 403}:
                        raise FetchError(
                            "FETCH_BLOCKED", "页面需要登录或授权访问，暂时无法读取正文。"
                        )
                    if response.status_code >= 400:
                        raise FetchError("FETCH_ERROR", f"网页返回状态码 {response.status_code}。")
                    raw = b""
                    truncated = False
                    for chunk in response.iter_bytes():
                        raw += chunk
                        if len(raw) >= max_bytes:
                            raw = raw[:max_bytes]
                            truncated = True
                            break
                    headers = {k.lower(): v for k, v in response.headers.items()}
                    final_url = str(response.url)
                    status_code = response.status_code
            except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.ConnectError) as exc:
                raise FetchError("FETCH_TIMEOUT", "读取网页超时，请稍后重试。") from exc
            except httpx.HTTPError as exc:
                raise FetchError("FETCH_ERROR", "无法读取该网页。") from exc

            text = _decode(raw, headers.get("content-type", ""))
            return FetchResult(
                url=url,
                final_url=final_url,
                status_code=status_code,
                headers=headers,
                text=text,
                raw=raw,
                truncated=truncated,
            )
        raise FetchError("FETCH_BLOCKED", "重定向次数过多，已停止跟随。")
    finally:
        if owns_client:
            client.close()
