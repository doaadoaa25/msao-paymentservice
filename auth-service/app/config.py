"""Configuration du service, lue depuis les variables d'environnement / le fichier .env."""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Base de données SQLite (fichier local)
    database_url: str = "sqlite:///./auth.db"

    # JWT
    jwt_secret_key: str = Field(default="CHANGE_ME_DEV_ONLY_SECRET_KEY_32_CHARS_MIN")
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60
    jwt_issuer: str = "msoa-auth-service"

    # CORS : origines autorisées, séparées par des virgules
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Compte de démonstration (identique au mode mock du frontend)
    seed_demo_user: bool = True
    demo_user_email: str = "demo@msoa.shop"
    demo_user_password: str = "demo123"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
