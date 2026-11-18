"""Préparation des tests : base SQLite temporaire, secret de test, client HTTP."""
import os
import tempfile
from pathlib import Path

# Variables définies AVANT d'importer l'application (la config est lue à l'import).
_TMP_DIR = Path(tempfile.mkdtemp(prefix="auth-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_TMP_DIR / 'test_auth.db').as_posix()}"
os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-pytest-only-0123456789"
os.environ["JWT_EXPIRE_MINUTES"] = "60"
os.environ["CORS_ORIGINS"] = "http://localhost:5173,http://127.0.0.1:5173"
os.environ["SEED_DEMO_USER"] = "true"
os.environ["DEMO_USER_EMAIL"] = "demo@msoa.shop"
os.environ["DEMO_USER_PASSWORD"] = "demo123"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed_demo_user  # noqa: E402


@pytest.fixture()
def client():
    """Base vide + utilisateur démo pour chaque test (tests indépendants)."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_demo_user(db)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def db_session():
    with SessionLocal() as db:
        yield db


@pytest.fixture()
def demo_token(client):
    response = client.post(
        "/api/auth/login", json={"email": "demo@msoa.shop", "password": "demo123"}
    )
    assert response.status_code == 200
    return response.json()["token"]


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
