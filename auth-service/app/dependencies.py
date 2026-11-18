"""Contrôle d'accès : extrait et valide le JWT de l'en-tête Authorization."""
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import RevokedToken, User
from app.security import decode_access_token

# auto_error=False : on renvoie nous-mêmes un 401 avec {"message": ...}
bearer_scheme = HTTPBearer(auto_error=False, description="JWT obtenu via POST /api/auth/login")


def _unauthorized(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_token_payload(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """Retourne le contenu du JWT s'il est valide, non expiré et non révoqué."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("Authentication required.")

    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Token has expired.")
    except jwt.PyJWTError:
        raise _unauthorized("Invalid token.")

    if db.get(RevokedToken, payload["jti"]) is not None:
        raise _unauthorized("Token has been revoked.")

    return payload


def get_current_user(
    payload: dict = Depends(get_token_payload),
    db: Session = Depends(get_db),
) -> User:
    user = db.get(User, payload["sub"])
    if user is None:
        raise _unauthorized("User no longer exists.")
    return user
