"""Tunnistautuminen FastAPI-palveluille (sama logiikka kuin Node-palveluiden requireAuth.ts).

Hyväksyy käyttäjän JWT:n (Authorization: Bearer ...) tai palveluiden välisen
x-service-token-otsakkeen. Kopio: apps/reporting-service/src/auth.py.
"""
import os
from typing import Optional

import jwt
from fastapi import Header, HTTPException

DEV_FALLBACK_SECRET = "dev-only-insecure-secret"


def _jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET")
    if secret:
        return secret
    if os.getenv("NODE_ENV") == "production" or os.getenv("ENV") == "production":
        raise RuntimeError("JWT_SECRET puuttuu ympäristömuuttujista")
    return DEV_FALLBACK_SECRET


def require_auth(
    authorization: Optional[str] = Header(default=None),
    x_service_token: Optional[str] = Header(default=None),
) -> dict:
    service_token = os.getenv("SERVICE_TOKEN")
    if service_token and x_service_token == service_token:
        return {"userId": "service", "role": "SERVICE"}

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Tunnistautuminen vaaditaan")
    try:
        payload = jwt.decode(authorization[7:], _jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Virheellinen tai vanhentunut kirjautuminen")
    return {"userId": payload.get("userId"), "role": payload.get("role")}
