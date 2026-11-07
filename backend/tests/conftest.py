"""pytest 共享基建：真实 PostgreSQL（trovia_test 库）+ FastAPI TestClient。"""
from __future__ import annotations

import os
import uuid

# Environment variables must be set before importing any app module; tests are forced onto their own database and never touch the dev one.
# When running test processes in parallel, point XUNJI_TEST_DB at different databases so they don't truncate each other's tables.
TEST_DB_NAME = os.environ.get("XUNJI_TEST_DB", "trovia_test")
os.environ["DATABASE_URL"] = (
    f"postgresql+psycopg://trovia:trovia@localhost:5432/{TEST_DB_NAME}"
)
os.environ.setdefault("AI_PROVIDER", "extractive")
os.environ.setdefault("EMBEDDING_PROVIDER", "local")
os.environ.setdefault("EMBEDDING_DIM", "1536")
os.environ.setdefault("LOG_LEVEL", "WARNING")

import psycopg  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import run_migrations  # noqa: E402

TEST_DB_URL = os.environ["DATABASE_URL"]
TABLES = (
    "document_relations",
    "processing_jobs",
    "document_chunks",
    "documents",
    "auth_tokens",
    "users",
)


def _ensure_database() -> None:
    dbname = TEST_DB_URL.rsplit("/", 1)[-1]
    base = TEST_DB_URL.rsplit("/", 1)[0].replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(f"{base}/postgres", autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,))
            if cur.fetchone() is None:
                cur.execute(f'CREATE DATABASE "{dbname}"')


@pytest.fixture(scope="session", autouse=True)
def database():
    _ensure_database()
    run_migrations()
    yield


@pytest.fixture(autouse=True)
def db_session(database):
    """每个测试之间清空业务表，返回一个可用会话。"""
    from app.db import get_session_factory

    session = get_session_factory()()
    with session.bind.connect() as conn:
        conn.execute(text("TRUNCATE " + ", ".join(TABLES) + " RESTART IDENTITY CASCADE"))
        conn.commit()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(scope="session")
def app_instance(database):
    from app.main import create_app

    return create_app()


@pytest.fixture()
def client(app_instance, db_session):
    with TestClient(app_instance) as test_client:
        yield test_client


@pytest.fixture()
def auth_headers(client) -> dict[str, str]:
    email = f"tester-{uuid.uuid4().hex[:8]}@trovia.test"
    response = client.post(
        "/api/v1/auth/register", json={"email": email, "password": "password123"}
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['data']['token']}"}


@pytest.fixture()
def second_auth_headers(client) -> dict[str, str]:
    email = f"other-{uuid.uuid4().hex[:8]}@trovia.test"
    response = client.post(
        "/api/v1/auth/register", json={"email": email, "password": "password123"}
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['data']['token']}"}
