"""Application configuration: everything comes from environment variables; never put secrets in source."""
from __future__ import annotations

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # Basics
    database_url: str = "postgresql+psycopg://trovia:trovia@localhost:5432/trovia"
    app_secret: str = ""
    log_level: str = "INFO"

    @field_validator("database_url")
    @classmethod
    def _normalize_database_url(cls, value: str) -> str:
        """Hosting platforms hand out postgres://… or postgresql://…, so the psycopg3 driver is filled in uniformly.

        SQLAlchemy looks for psycopg2 behind a bare postgresql://; this service only installs psycopg3,
        so without the conversion startup hits ModuleNotFoundError. A URL that already names a driver is
        kept as is.
        """
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix) :]
        return value

    # AI summaries ("openai" means any OpenAI-compatible service, including personal providers, proxies, Ollama and vLLM)
    ai_provider: str = "extractive"  # extractive | openai | openai-compatible
    ai_api_key: str = ""
    ai_base_url: str = "https://api.openai.com/v1"
    ai_model: str = "gpt-4o-mini"
    ai_chat_path: str = "/chat/completions"
    ai_auth_header: str = "Authorization"
    ai_auth_prefix: str = "Bearer"  # May be empty, which means the api_key is sent directly
    ai_extra_headers: str = "{}"  # JSON object, e.g. {"X-Custom":"value"}
    ai_json_mode: bool = True  # Set to false when the provider does not support response_format
    ai_timeout_seconds: float = 60.0

    # Embedding
    embedding_provider: str = "local"  # openai | openai-compatible | local
    embedding_api_key: str = ""
    embedding_base_url: str = "https://api.openai.com/v1"
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536
    embedding_path: str = "/embeddings"
    embedding_auth_header: str = "Authorization"
    embedding_auth_prefix: str = "Bearer"
    embedding_extra_headers: str = "{}"
    embedding_timeout_seconds: float = 60.0

    # Fetch safety
    fetch_timeout_seconds: float = 15.0
    fetch_max_bytes: int = 5 * 1024 * 1024
    fetch_max_redirects: int = 5
    fetch_allowed_ports: str = "80,443,8080,8443"

    # Chunking
    chunk_max_chars: int = 1200
    chunk_overlap: int = 150

    # Search fusion weights
    search_lexical_weight: float = 0.35
    search_semantic_weight: float = 0.35
    search_title_weight: float = 0.20
    search_meta_weight: float = 0.10
    search_min_score: float = 0.05
    search_vector_candidates: int = 50

    # Worker / jobs
    worker_poll_seconds: float = 1.0
    worker_lease_seconds: int = 300
    job_max_attempts: int = 3

    # Sessions
    token_ttl_days: int = 30

    @property
    def allowed_ports(self) -> set[int]:
        return {int(p.strip()) for p in self.fetch_allowed_ports.split(",") if p.strip()}

    @property
    def search_weights(self) -> dict[str, float]:
        return {
            "lexical": self.search_lexical_weight,
            "semantic": self.search_semantic_weight,
            "title": self.search_title_weight,
            "meta": self.search_meta_weight,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def validate_settings(settings: Settings) -> None:
    """Validated at startup: an invalid provider or dimension configuration fails immediately; incompatible vectors are never allowed into the database."""
    from app.ai.embedding import get_embedding_provider
    from app.ai.openai_compat import (
        is_openai_compatible,
        parse_extra_headers,
        require_openai_settings,
    )

    if settings.ai_provider not in {"openai", "openai-compatible", "openai_compatible", "extractive"}:
        raise RuntimeError(f"不支持的 AI_PROVIDER: {settings.ai_provider}")
    if settings.embedding_provider not in {
        "openai", "openai-compatible", "openai_compatible", "local",
    }:
        raise RuntimeError(f"不支持的 EMBEDDING_PROVIDER: {settings.embedding_provider}")

    if is_openai_compatible(settings.ai_provider):
        require_openai_settings(
            base_url=settings.ai_base_url,
            model=settings.ai_model,
            base_var="AI_BASE_URL",
            model_var="AI_MODEL",
        )
    if is_openai_compatible(settings.embedding_provider):
        require_openai_settings(
            base_url=settings.embedding_base_url,
            model=settings.embedding_model,
            base_var="EMBEDDING_BASE_URL",
            model_var="EMBEDDING_MODEL",
        )

    # Extra request headers must be a valid JSON object; surface it at startup instead of waiting for the first call to fail
    parse_extra_headers(settings.ai_extra_headers)
    parse_extra_headers(settings.embedding_extra_headers)
    if settings.ai_timeout_seconds <= 0 or settings.embedding_timeout_seconds <= 0:
        raise RuntimeError("AI / Embedding 超时时间必须为正数")

    provider = get_embedding_provider(settings)
    if provider.dim != settings.embedding_dim:
        raise RuntimeError(
            f"Embedding 维度不匹配: provider={provider.dim} schema={settings.embedding_dim}"
        )
