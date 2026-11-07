"""Authentication: scrypt password hashing plus opaque Bearer tokens (the database stores only SHA-256)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.models import AuthToken, User

_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32
    )
    return "scrypt${}${}${}${}${}".format(
        _SCRYPT_N,
        _SCRYPT_R,
        _SCRYPT_P,
        base64.b64encode(salt).decode(),
        base64.b64encode(digest).decode(),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt_b64, hash_b64 = stored.split("$")
        if algo != "scrypt":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        digest = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
        )
        return hmac.compare_digest(digest, expected)
    except (ValueError, TypeError):
        return False


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_token(session: Session, user: User) -> str:
    settings = get_settings()
    token = secrets.token_urlsafe(32)
    session.add(
        AuthToken(
            user_id=user.id,
            token_hash=_hash_token(token),
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.token_ttl_days),
        )
    )
    session.flush()
    return token


def revoke_token(session: Session, token: str) -> None:
    row = session.scalar(select(AuthToken).where(AuthToken.token_hash == _hash_token(token)))
    if row is not None and row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)


def current_user(
    request: Request,
    session: Session = Depends(get_db),
) -> User:
    """Resolve the current user from the verified auth context; never trust a user_id sent by the frontend."""
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise ApiError("UNAUTHORIZED", "请先登录。", 401)
    token = header[len("Bearer ") :].strip()
    if not token:
        raise ApiError("UNAUTHORIZED", "请先登录。", 401)
    row = session.scalar(
        select(AuthToken).where(
            AuthToken.token_hash == _hash_token(token),
            AuthToken.revoked_at.is_(None),
            AuthToken.expires_at > datetime.now(timezone.utc),
        )
    )
    if row is None:
        raise ApiError("UNAUTHORIZED", "登录已失效，请重新登录。", 401)
    user = session.get(User, row.user_id)
    if user is None:
        raise ApiError("UNAUTHORIZED", "登录已失效，请重新登录。", 401)
    return user


def get_current_user(
    user: User = Depends(current_user),
) -> User:
    return user


def validate_email(email: str) -> str:
    email = (email or "").strip()
    if not EMAIL_RE.match(email) or len(email) > 254:
        raise ApiError("INVALID_EMAIL", "请输入有效的邮箱地址。")
    return email


def validate_password(password: str) -> str:
    if not password or len(password) < 8:
        raise ApiError("INVALID_PASSWORD", "密码至少需要 8 位字符。")
    if len(password) > 200:
        raise ApiError("INVALID_PASSWORD", "密码过长。")
    return password


def new_user_id() -> uuid.UUID:
    return uuid.uuid4()
