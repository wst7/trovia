"""FastAPI 应用入口：python -m uvicorn app.main:app --port 8000"""
from __future__ import annotations

import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import auth_api, documents_api, health, search_api
from app.config import get_settings, validate_settings
from app.db import run_migrations
from app.errors import error_body, register_exception_handlers
from app.logging import get_logger, setup_logging

logger = get_logger("trovia.api")


@asynccontextmanager
async def lifespan(app):
    settings = get_settings()
    run_migrations()
    validate_settings(settings)
    logger.info("api_started", extra={"ai_provider": settings.ai_provider,
                                      "embedding_provider": settings.embedding_provider,
                                      "embedding_dim": settings.embedding_dim})
    yield


def create_app():
    settings = get_settings()
    setup_logging(settings.log_level)
    from fastapi import FastAPI

    app = FastAPI(
        title="Xunji API",
        version="0.1.0",
        description="个人链接收藏与智能找回引擎",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    register_exception_handlers(app)

    @app.middleware("http")
    async def access_log(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = int((time.perf_counter() - started) * 1000)
            logger.exception(
                "request_failed",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "duration_ms": duration_ms,
                    "status": 500,
                },
            )
            return JSONResponse(
                status_code=500,
                content=error_body("INTERNAL_ERROR", "服务内部错误，请稍后重试。"),
                headers={"x-request-id": request_id},
            )
        duration_ms = int((time.perf_counter() - started) * 1000)
        if request.url.path.startswith("/api/"):
            logger.info(
                "request",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "duration_ms": duration_ms,
                    "status": response.status_code,
                },
            )
        response.headers["x-request-id"] = request_id
        return response

    api = APIRouter(prefix="/api/v1")
    api.include_router(health.router)
    api.include_router(auth_api.router)
    api.include_router(documents_api.router)
    api.include_router(search_api.router)
    app.include_router(api)
    _mount_spa(app)
    return app


def _mount_spa(app) -> None:
    """让 API 进程顺带托管前端构建产物（单容器部署用）。

    免费 PaaS 通常只给一个 Web 服务，没有单独放 Nginx 的位置。把 `XUNJI_WEB_DIR`
    指向 `apps/web` 的构建目录，页面和接口就是同一个源：不需要 CORS，也不需要
    再维护一份反向代理配置。未设置该变量、或目录里没有 index.html 时完全跳过，
    行为与只跑 API 时一致。
    """
    raw = os.environ.get("XUNJI_WEB_DIR", "").strip()
    if not raw:
        return
    web_dir = Path(raw).resolve()
    index = web_dir / "index.html"
    if not index.is_file():
        logger.warning("web_dir_missing", extra={"web_dir": str(web_dir)})
        return

    # Hashed build assets are mounted separately and left to StaticFiles for cache headers and 304s.
    assets = web_dir / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        # Unknown paths under the API prefix must return a JSON 404, never fall back to index.html.
        if full_path == "api" or full_path.startswith("api/"):
            return JSONResponse(
                status_code=404, content=error_body("NOT_FOUND", "接口不存在。")
            )
        candidate = (web_dir / full_path).resolve()
        # Only real files inside the build directory are served; everything else (including ../ traversal) goes to index.html for the frontend router.
        if candidate.is_file() and web_dir in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(index)

    logger.info("web_static_mounted", extra={"web_dir": str(web_dir)})


app = create_app()
