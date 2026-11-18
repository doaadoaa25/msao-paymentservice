"""Point d'entrée FastAPI : CORS, format des erreurs, démarrage de la base."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import get_settings
from app.database import SessionLocal, init_db
from app.routers import auth
from app.seed import seed_demo_user

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    with SessionLocal() as db:
        seed_demo_user(db)
    yield


app = FastAPI(
    title="MSOA — Auth Service",
    description="Microservice d'authentification (port 8081) pour le TP MSOA E-commerce.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS : autorise uniquement le frontend Vite local (configurable dans .env).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=False,  # le token passe par l'en-tête Authorization, pas par cookie
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# --- Format d'erreur unique : {"message": "..."} -------------------------------
# apiClient.js lit `error.message` ; le format FastAPI par défaut ({"detail": ...})
# ne serait pas affiché correctement par la page Login.

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(_: Request, exc: StarletteHTTPException):
    message = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return JSONResponse(
        status_code=exc.status_code,
        content={"message": message},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError):
    errors = exc.errors()
    message = "Invalid request."
    if errors:
        first = errors[0]
        field = first.get("loc", [])[-1] if first.get("loc") else None
        if first.get("type") == "missing" or field == "name":
            message = "All fields are required."
        elif field == "email":
            message = "Invalid email address."
        elif field == "password" and first.get("type") == "string_too_short":
            message = "Password must be at least 6 characters."
        elif field == "password" and first.get("type") == "string_too_long":
            message = "Password must be at most 128 characters."
        else:
            message = f"{field}: {first.get('msg')}" if field else first.get("msg", message)
    return JSONResponse(
        status_code=422,  # Unprocessable Content (convention FastAPI pour la validation)
        content={"message": message, "errors": [
            {"field": ".".join(str(p) for p in e.get("loc", [])[1:]), "error": e.get("msg")}
            for e in errors
        ]},
    )


app.include_router(auth.router)


@app.get("/health", tags=["Monitoring"], summary="Vérifier que le service tourne")
def health() -> dict:
    return {"status": "UP", "service": "auth"}
