"""认证与会话。"""
from __future__ import annotations


def test_register_login_me_logout(client):
    email = "alice@trovia.test"
    reg = client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    assert reg.status_code == 201
    body = reg.json()["data"]
    assert body["user"]["email"] == email
    token = body["token"]
    assert len(token) > 20

    headers = {"Authorization": f"Bearer {token}"}
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["data"]["email"] == email

    out = client.post("/api/v1/auth/logout", headers=headers)
    assert out.status_code == 204
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401

    login = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert login.status_code == 200
    assert login.json()["data"]["token"]


def test_register_is_case_insensitive_on_email(client):
    first = client.post(
        "/api/v1/auth/register", json={"email": "Bob@Xunji.test", "password": "password123"}
    )
    assert first.status_code == 201
    dup = client.post(
        "/api/v1/auth/register", json={"email": "bob@trovia.test", "password": "password123"}
    )
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "EMAIL_TAKEN"


def test_login_with_wrong_password(client):
    client.post("/api/v1/auth/register", json={"email": "c@trovia.test", "password": "password123"})
    bad = client.post("/api/v1/auth/login", json={"email": "c@trovia.test", "password": "wrong-pass"})
    assert bad.status_code == 401
    assert bad.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_unknown_user(client):
    resp = client.post("/api/v1/auth/login", json={"email": "nobody@trovia.test", "password": "password123"})
    assert resp.status_code == 401


def test_weak_password_and_bad_email_rejected(client):
    weak = client.post("/api/v1/auth/register", json={"email": "d@trovia.test", "password": "1234567"})
    assert weak.status_code == 400
    assert weak.json()["error"]["code"] == "INVALID_PASSWORD"

    bad_email = client.post("/api/v1/auth/register", json={"email": "not-an-email", "password": "password123"})
    assert bad_email.status_code == 400
    assert bad_email.json()["error"]["code"] == "INVALID_EMAIL"


def test_missing_or_bad_token_rejected(client):
    assert client.get("/api/v1/auth/me").status_code == 401
    assert (
        client.get("/api/v1/auth/me", headers={"Authorization": "Bearer deadbeef"}).status_code
        == 401
    )
    error = client.get("/api/v1/auth/me").json()["error"]
    assert error["code"] == "UNAUTHORIZED"
    assert error["message"]
