"""OpenAI 兼容服务的通用请求构造：路径、鉴权头与额外请求头。

个人服务商、中转站、Ollama、vLLM 等通常都提供 OpenAI 兼容接口，
差异主要集中在 base URL、路径、鉴权头和少量自定义头上，因此这里统一处理。
"""
from __future__ import annotations

import json

OPENAI_COMPATIBLE_ALIASES = {"openai", "openai-compatible", "openai_compatible"}


def is_openai_compatible(provider: str) -> bool:
    """openai / openai-compatible 都表示“任意 OpenAI 兼容服务”。"""
    return (provider or "").strip().lower() in OPENAI_COMPATIBLE_ALIASES


def require_openai_settings(
    *,
    base_url: str,
    model: str,
    base_var: str,
    model_var: str,
) -> None:
    """兼容服务至少需要地址与模型名；API Key 可为空（本地服务）。"""
    if not (base_url or "").strip():
        raise RuntimeError(f"OpenAI 兼容服务必须配置 {base_var}")
    if not (model or "").strip():
        raise RuntimeError(f"OpenAI 兼容服务必须配置 {model_var}")


def parse_extra_headers(raw: str) -> dict[str, str]:
    """解析 JSON 对象形式的额外请求头；空值返回空字典。"""
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
    """构造请求头；api_key 为空时不发送鉴权头（适配 Ollama 等本地服务）。"""
    headers = {"User-Agent": "trovia/0.1"}
    headers.update(parse_extra_headers(extra_headers))
    if api_key:
        header = (auth_header or "Authorization").strip()
        prefix = (auth_prefix or "").strip()
        headers[header] = f"{prefix} {api_key}".strip()
    return headers


def build_url(base_url: str, path: str) -> str:
    """拼接 base URL 与接口路径；path 可带查询参数（如 Azure 的 api-version）。"""
    base = (base_url or "").rstrip("/")
    suffix = path or ""
    if suffix and not suffix.startswith("/"):
        suffix = "/" + suffix
    return base + suffix
