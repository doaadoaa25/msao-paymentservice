"""Tests automatisés du microservice Auth (lancer : python -m pytest -v)."""
from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy import select

from app.config import get_settings
from app.models import User
from tests.conftest import auth_header

NEW_USER = {"name": "Sara Test", "email": "sara@example.com", "password": "secret123"}


# ---------------------------------------------------------------- health
def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "UP"


# ---------------------------------------------------------------- register
def test_register_returns_public_user_with_201(client):
    response = client.post("/api/auth/register", json=NEW_USER)
    assert response.status_code == 201
    body = response.json()
    assert set(body.keys()) == {"id", "name", "email", "role"}
    assert body["name"] == "Sara Test"
    assert body["email"] == "sara@example.com"
    assert body["role"] == "CUSTOMER"
    assert "password" not in body and "password_hash" not in body


def test_register_stores_argon2_hash_not_plain_password(client, db_session):
    client.post("/api/auth/register", json=NEW_USER)
    user = db_session.scalar(select(User).where(User.email == "sara@example.com"))
    assert user is not None
    assert user.password_hash.startswith("$argon2id$")
    assert "secret123" not in user.password_hash


def test_register_normalizes_email_and_trims_name(client):
    response = client.post(
        "/api/auth/register",
        json={"name": "  Sara  ", "email": "  Sara@Example.COM ", "password": "secret123"},
    )
    assert response.status_code == 201
    assert response.json()["email"] == "sara@example.com"
    assert response.json()["name"] == "Sara"


def test_register_duplicate_email_returns_409(client):
    client.post("/api/auth/register", json=NEW_USER)
    response = client.post(
        "/api/auth/register", json={**NEW_USER, "email": "SARA@example.com"}
    )
    assert response.status_code == 409
    assert response.json() == {"message": "Email already registered."}


def test_register_demo_email_is_taken(client):
    response = client.post(
        "/api/auth/register",
        json={"name": "X", "email": "demo@msoa.shop", "password": "whatever1"},
    )
    assert response.status_code == 409


def test_register_cannot_choose_role(client):
    response = client.post("/api/auth/register", json={**NEW_USER, "role": "ADMIN"})
    assert response.status_code == 201
    assert response.json()["role"] == "CUSTOMER"


def test_register_invalid_email_returns_422_with_message(client):
    response = client.post("/api/auth/register", json={**NEW_USER, "email": "not-an-email"})
    assert response.status_code == 422
    assert response.json()["message"] == "Invalid email address."


def test_register_short_password_returns_422(client):
    response = client.post("/api/auth/register", json={**NEW_USER, "password": "12345"})
    assert response.status_code == 422
    assert response.json()["message"] == "Password must be at least 6 characters."


def test_register_blank_name_returns_422(client):
    response = client.post("/api/auth/register", json={**NEW_USER, "name": "   "})
    assert response.status_code == 422
    assert response.json()["message"] == "All fields are required."


def test_register_missing_field_returns_422(client):
    response = client.post(
        "/api/auth/register", json={"email": "a@example.com", "password": "secret123"}
    )
    assert response.status_code == 422
    assert response.json()["message"] == "All fields are required."


# ---------------------------------------------------------------- login
def test_login_demo_user_returns_user_and_token(client):
    response = client.post(
        "/api/auth/login", json={"email": "demo@msoa.shop", "password": "demo123"}
    )
    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"user", "token"}
    assert body["user"] == {
        "id": "user-1",
        "name": "Demo Customer",
        "email": "demo@msoa.shop",
        "role": "CUSTOMER",
    }
    assert isinstance(body["token"], str) and body["token"].count(".") == 2


def test_login_after_register(client):
    client.post("/api/auth/register", json=NEW_USER)
    response = client.post(
        "/api/auth/login", json={"email": "SARA@example.com", "password": "secret123"}
    )
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "sara@example.com"


def test_login_wrong_password_returns_401(client):
    response = client.post(
        "/api/auth/login", json={"email": "demo@msoa.shop", "password": "wrong-password"}
    )
    assert response.status_code == 401
    assert response.json() == {"message": "Invalid email or password."}


def test_login_unknown_email_returns_same_401(client):
    response = client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": "demo123"}
    )
    assert response.status_code == 401
    assert response.json() == {"message": "Invalid email or password."}


def test_login_token_contains_expected_claims(client, demo_token):
    settings = get_settings()
    payload = jwt.decode(
        demo_token, settings.jwt_secret_key, algorithms=["HS256"], issuer=settings.jwt_issuer
    )
    assert payload["sub"] == "user-1"
    assert payload["role"] == "CUSTOMER"
    assert "jti" in payload and "exp" in payload


# ---------------------------------------------------------------- me
def test_me_with_valid_token(client, demo_token):
    response = client.get("/api/auth/me", headers=auth_header(demo_token))
    assert response.status_code == 200
    assert response.json() == {
        "id": "user-1",
        "name": "Demo Customer",
        "email": "demo@msoa.shop",
        "role": "CUSTOMER",
    }


def test_me_without_token_returns_401(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.json() == {"message": "Authentication required."}


def test_me_with_garbage_token_returns_401(client):
    response = client.get("/api/auth/me", headers=auth_header("abc.def.ghi"))
    assert response.status_code == 401
    assert response.json() == {"message": "Invalid token."}


def test_me_with_token_signed_by_another_secret_returns_401(client):
    now = datetime.now(timezone.utc)
    forged = jwt.encode(
        {"sub": "user-1", "role": "ADMIN", "jti": "x", "iat": now,
         "exp": now + timedelta(minutes=5), "iss": get_settings().jwt_issuer},
        "attacker-secret-attacker-secret-1234",
        algorithm="HS256",
    )
    response = client.get("/api/auth/me", headers=auth_header(forged))
    assert response.status_code == 401


def test_me_with_expired_token_returns_401(client):
    settings = get_settings()
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    expired = jwt.encode(
        {"sub": "user-1", "role": "CUSTOMER", "jti": "old", "iat": past,
         "exp": past + timedelta(minutes=5), "iss": settings.jwt_issuer},
        settings.jwt_secret_key,
        algorithm="HS256",
    )
    response = client.get("/api/auth/me", headers=auth_header(expired))
    assert response.status_code == 401
    assert response.json() == {"message": "Token has expired."}


def test_me_with_unsigned_alg_none_token_returns_401(client):
    token = jwt.encode({"sub": "user-1", "jti": "n"}, None, algorithm="none")
    response = client.get("/api/auth/me", headers=auth_header(token))
    assert response.status_code == 401


# ---------------------------------------------------------------- logout
def test_logout_revokes_token(client, demo_token):
    assert client.get("/api/auth/me", headers=auth_header(demo_token)).status_code == 200

    response = client.post("/api/auth/logout", headers=auth_header(demo_token))
    assert response.status_code == 200
    assert response.json()["success"] is True

    after = client.get("/api/auth/me", headers=auth_header(demo_token))
    assert after.status_code == 401
    assert after.json() == {"message": "Token has been revoked."}


def test_logout_only_revokes_the_presented_token(client):
    creds = {"email": "demo@msoa.shop", "password": "demo123"}
    token_a = client.post("/api/auth/login", json=creds).json()["token"]
    token_b = client.post("/api/auth/login", json=creds).json()["token"]

    client.post("/api/auth/logout", headers=auth_header(token_a))

    assert client.get("/api/auth/me", headers=auth_header(token_a)).status_code == 401
    assert client.get("/api/auth/me", headers=auth_header(token_b)).status_code == 200


def test_logout_is_idempotent_without_token(client):
    response = client.post("/api/auth/logout")
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_logout_twice_is_ok(client, demo_token):
    assert client.post("/api/auth/logout", headers=auth_header(demo_token)).status_code == 200
    assert client.post("/api/auth/logout", headers=auth_header(demo_token)).status_code == 200


# ---------------------------------------------------------------- CORS
def test_cors_preflight_allows_vite_frontend(client):
    response = client.options(
        "/api/auth/login",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_rejects_unknown_origin(client):
    response = client.options(
        "/api/auth/login",
        headers={"Origin": "http://evil.example.com", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in response.headers


# ---------------------------------------------------------------- base du professeur
def test_seed_replaces_professor_placeholder_hash(client, db_session):
    """La base fournie contient un faux hash : le seed doit le remplacer."""
    from app.seed import seed_demo_user

    user = db_session.get(User, "user-1")
    user.password_hash = "DEMO_ONLY_REPLACE_WITH_REAL_PASSWORD_HASH"
    db_session.commit()

    seed_demo_user(db_session)

    response = client.post(
        "/api/auth/login", json={"email": "demo@msoa.shop", "password": "demo123"}
    )
    assert response.status_code == 200
