import asyncio
import os

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

JWKS_URL = os.environ["JWKS_URL"]  # например https://auth.example.com/.well-known/jwks.json
JWT_ISSUER = os.getenv("JWT_ISSUER")  # необязательно
JWT_AUDIENCE = os.getenv("JWT_AUDIENCE")  # необязатльно
JWT_ALGORITHMS = os.getenv("JWT_ALGORITHMS", "RS256").split(",")
REFRESH_COOKIE_NAME = os.getenv("REFRESH_COOKIE_NAME", "refresh_token")

# Роль, которой разрешено добавлять/менять/удалять рецепты.
# Пустое значение (ADMIN_ROLE=) отключает проверку роли: достаточно быть подтверждённым.
ADMIN_ROLE = os.getenv("ADMIN_ROLE", "admin")
ROLES_CLAIM = os.getenv("ROLES_CLAIM", "roles")

# кэширует ключи; при неизвестном kid перезапрашивает JWKS
_jwks_client = PyJWKClient(JWKS_URL, cache_keys=True, lifespan=3600)
_bearer = HTTPBearer(auto_error=False)


def _decode(token: str) -> dict:
    signing_key = _jwks_client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=JWT_ALGORITHMS,
        issuer=JWT_ISSUER,
        audience=JWT_AUDIENCE,
        options={
            "require": ["exp", "sub"],
            "verify_aud": JWT_AUDIENCE is not None,
            "verify_iss": JWT_ISSUER is not None,
        },
    )


async def verify_token(token: str) -> dict:
    # PyJWKClient синхронный (может ходить в сеть) — уводим в поток
    return await asyncio.to_thread(_decode, token)


async def get_optional_claims(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict | None:
    """
    Claims access-токена, если пользователь подтверждён:
      - есть валидный access-токен в Authorization: Bearer ...
      - есть валидный refresh-токен в куке
      - sub у обоих совпадает
    Иначе None (неподтверждённый).
    """
    refresh = request.cookies.get(REFRESH_COOKIE_NAME)
    if creds is None or not refresh:
        return None

    try:
        access_claims = await verify_token(creds.credentials)
        refresh_claims = await verify_token(refresh)
    except jwt.PyJWTError:
        return None

    if access_claims["sub"] != refresh_claims["sub"]:
        return None

    return access_claims


async def get_optional_user_id(
    claims: dict | None = Depends(get_optional_claims),
) -> str | None:
    return str(claims["sub"]) if claims else None


def can_manage_recipes(claims: dict) -> bool:
    if not ADMIN_ROLE:
        return True
    roles = claims.get(ROLES_CLAIM, [])
    if isinstance(roles, str):
        roles = roles.split()
    return ADMIN_ROLE in roles