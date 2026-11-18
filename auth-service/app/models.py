"""Tables de la base auth.db.

La table `users` reprend exactement le schéma fourni par le professeur
(msoa_sqlite_databases/auth/schema.sql) :
    users(id TEXT PK, name, email UNIQUE, password_hash, role DEFAULT 'CUSTOMER', created_at TEXT)

La table `revoked_tokens` est un ajout propre au service : elle sert à la
révocation des JWT lors du logout (liste de refus / denylist).
"""
from datetime import datetime, timezone

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def utc_now_iso() -> str:
    """Date ISO 8601 en UTC, format identique au seed du professeur (ex. 2026-11-04T10:00:00Z)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False, default="CUSTOMER", server_default="CUSTOMER")
    created_at: Mapped[str] = mapped_column(Text, nullable=False, default=utc_now_iso)


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"

    jti: Mapped[str] = mapped_column(String(64), primary_key=True)  # identifiant unique du JWT
    user_id: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[int] = mapped_column(nullable=False)  # timestamp Unix (claim exp)
    revoked_at: Mapped[str] = mapped_column(Text, nullable=False, default=utc_now_iso)
