import asyncio
import os

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError

# в compose: http://auth:8000/.well-known/jwks.json
JWKS_URL = os.environ["JWKS_URL"]
JWT_ISSUER = os.getenv("JWT_ISSUER", "food-tinder-jwt-vendor")
JWT_AUDIENCE = os.getenv("JWT_AUDIENCE")  # необязательно, auth его пока не выставляет

# Алгоритм зафиксирован намеренно: не настраивается через env,
# чтобы случайно не разрешить HS256/none.
ALGORITHMS = ["RS256"]

# Роль, которой разрешено добавлять/менять/удалять рецепты.
# Пустое значение (ADMIN_ROLE=) отключает проверку роли: достаточно быть авторизованным.
ADMIN_ROLE = os.getenv("ADMIN_ROLE", "admin")
ROLES_CLAIM = os.getenv("ROLES_CLAIM", "roles")

# кэширует ключи; при неизвестном kid перезапрашивает JWKS
_jwks_client = PyJWKClient(JWKS_URL, cache_keys=True, lifespan=3600)
_bearer = HTTPBearer(auto_error=False)

_UNAUTHORIZED_HEADERS = {"WWW-Authenticate": "Bearer"}


def _decode(token: str) -> dict:
    signing_key = _jwks_client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=ALGORITHMS,
        issuer=JWT_ISSUER,
        audience=JWT_AUDIENCE,
        options={
            "require": ["exp", "sub", "iss"],
            "verify_aud": JWT_AUDIENCE is not None,
        },
    )


async def verify_token(token: str) -> dict:
    """Проверяет подпись/exp/iss и что это именно access-токен."""
    try:
        # PyJWKClient синхронный (может ходить в сеть) — уводим в поток
        claims = await asyncio.to_thread(_decode, token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired", headers=_UNAUTHORIZED_HEADERS)
    except PyJWKClientConnectionError:
        # auth недоступен — это не «плохой токен»
        raise HTTPException(503, "Auth service unavailable")
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid token", headers=_UNAUTHORIZED_HEADERS)

    if claims.get("type") != "access":
        raise HTTPException(401, "Expected access token", headers=_UNAUTHORIZED_HEADERS)
    return claims


async def get_optional_claims(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict | None:
    """Нет токена -> None (аноним). Токен есть, но плохой/просрочен -> 401,
    чтобы клиент знал, что нужно сделать /refresh."""
    if creds is None:
        return None
    return await verify_token(creds.credentials)


async def get_required_claims(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if creds is None:
        raise HTTPException(401, "Authorization header missing", headers=_UNAUTHORIZED_HEADERS)
    return await verify_token(creds.credentials)


async def get_optional_user_id(
    claims: dict | None = Depends(get_optional_claims),
) -> str | None:
    return str(claims["sub"]) if claims else None


async def get_required_user_id(
    claims: dict = Depends(get_required_claims),
) -> str:
    return str(claims["sub"])


def can_manage_recipes(claims: dict) -> bool:
    if not ADMIN_ROLE:
        return True
    roles = claims.get(ROLES_CLAIM, [])
    if isinstance(roles, str):
        roles = roles.split()
    return ADMIN_ROLE in roles


async def require_recipe_manager(
    claims: dict = Depends(get_required_claims),
) -> dict:
    """Зависимость для POST/PATCH/DELETE рецептов."""
    if not can_manage_recipes(claims):
        raise HTTPException(403, "Forbidden")
    return claims