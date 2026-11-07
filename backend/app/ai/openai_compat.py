"""Shared request construction for OpenAI-compatible services: path, auth header and extra request headers.

Personal providers, relay stations, Ollama, vLLM and the like usually all expose an OpenAI-compatible
API; the differences come down to the base URL, path, auth header and a handful of custom headers, so
they are handled uniformly here.
"""
from __future__ import annotations

import json

OPENAI_COMPATIBLE_ALIASES = {"openai", "openai-compatible", "openai_compatible"}


def is_openai_compatible(provider: str) -> bool:
    """openai / openai-compatible both mean "any OpenAI-compatible service"."""
    return (provider or "").strip().lower() in OPENAI_COMPATIBLE_ALIASES


def require_openai_settings(
    *,
    base_url: str,
    model: str,
    base_var: str,
    model_var: str,
) -> None:
    """A compatible service needs at least an address and a model name; the API key may be empty (local services)."""
    if not (base_url or "").strip():
        raise RuntimeError(f"OpenAI 兼容服务必须配置 {base_var}")
    if not (model or "").strip():
        raise RuntimeError(f"OpenAI 兼容服务必须配置 {model_var}")


def parse_extra_headers(raw: str) -> dict[str, str]:
    """Parse extra request headers given as a JSON object; an empty value returns an empty dict."""
    if not raw or not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"额外请求头必须是合法 JSON 对象：{exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError("额外请求头必须是 JSON 对象")
    return {str(key): str(value) for key, value in data.items()}


def build_headers(
    *,
    api_key: str,
    auth_header: str,
    auth_prefix: str,
    extra_headers: str,
) -> dict[str, str]:
    """Build the request headers; no auth header is sent when api_key is empty (fits local services such as Ollama)."""
    headers = {"User-Agent": "trovia/0.1"}
    headers.update(parse_extra_headers(extra_headers))
    if api_key:
        header = (auth_header or "Authorization").strip()
        prefix = (auth_prefix or "").strip()
        headers[header] = f"{prefix} {api_key}".strip()
    return headers


def build_url(base_url: str, path: str) -> str:
    """Join the base URL with the endpoint path; path may carry query parameters (e.g. Azure's api-version)."""
    base = (base_url or "").rstrip("/")
    suffix = path or ""
    if suffix and not suffix.startswith("/"):
        suffix = "/" + suffix
    return base + suffix
