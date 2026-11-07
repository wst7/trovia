"""Unified errors: every API error response looks like {"error": {"code", "message"}}."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger("trovia.errors")


class ApiError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class FetchError(Exception):
    """Fetch-stage error; may carry an error code, which the pipeline turns into the job failure reason."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class RetryableJobError(Exception):
    """A retryable job error."""

    def __init__(self, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class FatalJobError(Exception):
    """A non-retryable job error (e.g. the URL was rejected by the safety policy)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def error_body(code: str, message: str) -> dict[str, Any]:
    return {"error": {"code": code, "message": message}}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code, content=error_body(exc.code, exc.message)
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        loc = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        detail = first.get("msg", "参数不合法")
        return JSONResponse(
            status_code=400,
            content=error_body("VALIDATION_ERROR", f"{loc or '请求参数'}: {detail}"),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled_error path=%s", request.url.path)
        return JSONResponse(
            status_code=500,
            content=error_body("INTERNAL_ERROR", "服务内部错误，请稍后重试。"),
        )
