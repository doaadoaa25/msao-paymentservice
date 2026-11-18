"""Schémas Pydantic : forme exacte des JSON reçus et renvoyés.

Contrats déduits de src/services/authService.js du frontend :
  - login    : corps {email, password}            -> réponse {user, token}
  - register : corps {name, email, password}      -> réponse = objet user public
  - me       : en-tête Authorization: Bearer <jwt> -> réponse = objet user public
  - user     : {id, name, email, role}  (jamais le mot de passe)
"""
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    # Les champs inconnus (ex. "role": "ADMIN") sont ignorés : le rôle n'est
    # jamais choisi par le client.
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    # min 6 : même règle que le champ mot de passe du formulaire React (minLength: 6)
    # max 128 : évite qu'un mot de passe géant ralentisse Argon2 (déni de service)
    password: str = Field(min_length=6, max_length=128)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("All fields are required.")
        return value

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class LoginRequest(BaseModel):
    # Pas d'EmailStr ici : un email mal formé doit simplement donner
    # "Invalid email or password." (401), comme en mode mock.
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    email: str
    role: str


class LoginResponse(BaseModel):
    user: UserOut
    token: str


class LogoutResponse(BaseModel):
    success: bool
    message: str


class ErrorResponse(BaseModel):
    """Format d'erreur lu par apiClient.js : `error.message`."""

    message: str
