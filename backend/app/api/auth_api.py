"""Auth API: register / login / logout / current user."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import (
    get_current_user,
    hash_password,
    issue_token,
    revoke_token,
    validate_email,
    validate_password,
    verify_password,
)
from app.db import get_db
from app.errors import ApiError
from app.models import User
from app.schemas import AuthPayload, DataEnvelope, LoginRequest, RegisterRequest, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=DataEnvelope[AuthPayload],
    status_code=status.HTTP_201_CREATED,
)
def register(
    payload: RegisterRequest,
    session: Session = Depends(get_db),
) -> DataEnvelope[AuthPayload]:
    email = validate_email(payload.email)
    password = validate_password(payload.password)
    user = User(email=email, password_hash=hash_password(password))
    session.add(user)
    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        raise ApiError("EMAIL_TAKEN", "该邮箱已注册，请直接登录。", 409) from exc
    token = issue_token(session, user)
    session.commit()
    session.refresh(user)
    return DataEnvelope(data=AuthPayload(token=token, user=UserOut.model_validate(user)))


@router.post("/login", response_model=DataEnvelope[AuthPayload])
def login(
    payload: LoginRequest, session: Session = Depends(get_db)
) -> DataEnvelope[AuthPayload]:
    email = (payload.email or "").strip().lower()
    user = session.scalar(select(User).where(func.lower(User.email) == email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise ApiError("INVALID_CREDENTIALS", "邮箱或密码不正确。", 401)
    token = issue_token(session, user)
    session.commit()
    return DataEnvelope(data=AuthPayload(token=token, user=UserOut.model_validate(user)))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    session: Session = Depends(get_db),
) -> None:
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        revoke_token(session, header[len("Bearer ") :].strip())
        session.commit()


@router.get("/me", response_model=DataEnvelope[UserOut])
def me(user: User = Depends(get_current_user)) -> DataEnvelope[UserOut]:
    return DataEnvelope(data=UserOut.model_validate(user))
