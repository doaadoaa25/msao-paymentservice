"""Endpoints REST du contrat Auth (README du professeur, section 5)."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import jwt

from app.database import get_db
from app.dependencies import bearer_scheme, get_current_user
from app.models import RevokedToken, User
from app.schemas import (
    ErrorResponse,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    RegisterRequest,
    UserOut,
)
from app.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    needs_rehash,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["Auth"])

INVALID_CREDENTIALS = "Invalid email or password."  # même message que le mock React


@router.post(
    "/register",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    summary="Créer un compte (rôle CUSTOMER)",
    responses={409: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
)
def register(body: RegisterRequest, db: Session = Depends(get_db)) -> User:
    if db.scalar(select(User).where(User.email == body.email)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered.")

    user = User(
        id=str(uuid.uuid4()),  # le mock React utilise aussi crypto.randomUUID()
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        role="CUSTOMER",  # jamais fourni par le client
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # deux inscriptions simultanées avec le même email
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered.")
    db.refresh(user)
    return user


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Se connecter : renvoie {user, token}",
    responses={401: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
)
def login(body: LoginRequest, db: Session = Depends(get_db)) -> dict:
    user = db.scalar(select(User).where(User.email == body.email))

    if not verify_password(body.password, user.password_hash if user else None):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            INVALID_CREDENTIALS,
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Si les paramètres Argon2 ont changé depuis l'inscription, on re-hache.
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
        db.commit()

    return {"user": user, "token": create_access_token(user.id, user.role)}


@router.post(
    "/logout",
    response_model=LogoutResponse,
    summary="Se déconnecter : révoque le JWT présenté",
)
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """Logout idempotent.

    - Token valide  -> son `jti` est ajouté à la table revoked_tokens ;
      toute requête ultérieure avec ce token reçoit 401.
    - Token absent / expiré / invalide -> rien à révoquer, on répond quand même 200.
      Raison : authService.js relance l'erreur de logout, et AuthContext ne
      remettrait alors pas `user` à null (l'interface resterait "connectée").
    """
    # Nettoyage : les tokens expirés n'ont plus besoin d'être mémorisés.
    now_ts = int(datetime.now(timezone.utc).timestamp())
    db.execute(delete(RevokedToken).where(RevokedToken.expires_at < now_ts))

    if credentials is not None:
        try:
            payload = decode_access_token(credentials.credentials)
        except jwt.PyJWTError:
            payload = None

        if payload and db.get(RevokedToken, payload["jti"]) is None:
            db.add(
                RevokedToken(
                    jti=payload["jti"],
                    user_id=payload["sub"],
                    expires_at=int(payload["exp"]),
                )
            )
    db.commit()
    return {"success": True, "message": "Logged out successfully."}


@router.get(
    "/me",
    response_model=UserOut,
    summary="Utilisateur courant (nécessite un Bearer token)",
    responses={401: {"model": ErrorResponse}},
)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user
