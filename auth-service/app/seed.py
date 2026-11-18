"""Création du compte de démonstration (demo@msoa.shop / demo123).

- id = "user-1" : même identifiant que le mock React et que le seed Orders
  (la commande 'order-demo-001' appartient à 'user-1').
- Si la base fournie par le professeur est utilisée, le mot de passe y est un
  simple texte "DEMO_ONLY_REPLACE_WITH_REAL_PASSWORD_HASH" : on le remplace
  par un vrai hash Argon2.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import User
from app.security import hash_password, is_argon2_hash

DEMO_USER_ID = "user-1"
DEMO_USER_NAME = "Demo Customer"


def seed_demo_user(db: Session) -> None:
    settings = get_settings()
    if not settings.seed_demo_user:
        return

    email = settings.demo_user_email.strip().lower()
    user = db.get(User, DEMO_USER_ID) or db.scalar(select(User).where(User.email == email))

    if user is None:
        db.add(
            User(
                id=DEMO_USER_ID,
                name=DEMO_USER_NAME,
                email=email,
                password_hash=hash_password(settings.demo_user_password),
                role="CUSTOMER",
            )
        )
        db.commit()
    elif not is_argon2_hash(user.password_hash):
        user.password_hash = hash_password(settings.demo_user_password)
        db.commit()
