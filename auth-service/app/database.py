"""Connexion SQLite via SQLAlchemy et fourniture d'une session par requête."""
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

# check_same_thread=False : nécessaire car FastAPI peut utiliser la connexion
# depuis plusieurs threads (SQLite l'interdit par défaut).
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    """Classe de base de tous les modèles SQLAlchemy."""


def get_db() -> Generator[Session, None, None]:
    """Dépendance FastAPI : ouvre une session, la referme après la requête."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Crée les tables si elles n'existent pas encore."""
    from app import models  # noqa: F401  (enregistre les modèles)

    Base.metadata.create_all(bind=engine)
