"""Hachage Argon2 des mots de passe et création / vérification des JWT."""
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.config import get_settings

settings = get_settings()

# Paramètres par défaut d'argon2-cffi (Argon2id, recommandés par l'OWASP).
_hasher = PasswordHasher()

# Hash factice : utilisé quand l'email n'existe pas, pour que la réponse prenne
# le même temps qu'avec un vrai compte (évite de deviner les emails inscrits).
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        _safe_verify(_DUMMY_HASH, password)
        return False
    return _safe_verify(password_hash, password)


def _safe_verify(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def is_argon2_hash(value: str) -> bool:
    return value.startswith("$argon2")


def create_access_token(user_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,  # identifiant de l'utilisateur
        "role": role,
        "jti": uuid.uuid4().hex,  # identifiant unique du token (sert à la révocation)
        "iss": settings.jwt_issuer,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """Vérifie signature, expiration et émetteur. Lève jwt.PyJWTError si invalide."""
    return jwt.decode(
        token,
        settings.jwt_secret_key,
        algorithms=[settings.jwt_algorithm],  # liste fixe : empêche l'attaque "alg=none"
        issuer=settings.jwt_issuer,
        options={"require": ["sub", "jti", "exp", "iat", "iss"]},
    )
