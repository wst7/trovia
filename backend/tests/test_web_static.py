"""单容器部署：API 顺带托管前端构建产物（XUNJI_WEB_DIR）。"""
from __future__ import annotations

from pathlib import Path


def _build_app_with_web(tmp_path: Path):
    (tmp_path / "index.html").write_text("<html>app-shell</html>", encoding="utf-8")
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "app.js").write_text("console.log(1)", encoding="utf-8")
    return tmp_path


def test_spa_fallback_serves_index_for_client_routes(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import create_app

    web_dir = _build_app_with_web(tmp_path)
    monkeypatch.setenv("XUNJI_WEB_DIR", str(web_dir))

    with TestClient(create_app()) as client:
        # Frontend routes (the in-app /documents/:id) fall back to index.html
        response = client.get("/documents/abc")
        assert response.status_code == 200
        assert "app-shell" in response.text

        # Build artefacts that really exist are returned as files
        asset = client.get("/assets/app.js")
        assert asset.status_code == 200
        assert asset.text == "console.log(1)"

        # The API keeps working as usual
        assert client.get("/api/v1/health").json()["status"] in {"ok", "degraded"}


def test_api_paths_never_fall_back_to_html(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import create_app

    web_dir = _build_app_with_web(tmp_path)
    monkeypatch.setenv("XUNJI_WEB_DIR", str(web_dir))

    with TestClient(create_app()) as client:
        response = client.get("/api/v1/not-a-route")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "NOT_FOUND"


def test_without_web_dir_only_api_is_served(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import create_app

    monkeypatch.delenv("XUNJI_WEB_DIR", raising=False)

    with TestClient(create_app()) as client:
        assert client.get("/documents/abc").status_code == 404


def test_missing_web_dir_is_ignored(tmp_path, monkeypatch):
    """配错了目录不应该让服务起不来，只是不发页面。"""
    from fastapi.testclient import TestClient

    from app.main import create_app

    monkeypatch.setenv("XUNJI_WEB_DIR", str(tmp_path / "nope"))

    with TestClient(create_app()) as client:
        assert client.get("/api/v1/health").status_code == 200
        assert client.get("/documents/abc").status_code == 404
