import base64
import hmac
import json
import uuid
import warnings
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends
from fastapi.exceptions import HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.algorithms import RSAAlgorithm

import config

ALGORITHM = "RS256"
bearer_scheme = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------- RSA keys

def _load_private_key():
    pem = config.JWT_PRIVATE_KEY_PEM
    if pem:
        pem = pem.replace("\\n", "\n")
    elif config.JWT_PRIVATE_KEY_PATH:
        pem = Path(config.JWT_PRIVATE_KEY_PATH).read_text()

    if pem:
        return serialization.load_pem_private_key(pem.encode(), password=None)

    warnings.warn(
        "JWT_PRIVATE_KEY_PEM / JWT_PRIVATE_KEY_PATH не заданы: сгенерирован "
        "временный RSA-ключ. Токены перестанут работать после перезапуска!",
        RuntimeWarning,
    )
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


_private_key = _load_private_key()
_public_key = _private_key.public_key()
_public_jwk: dict = json.loads(RSAAlgorithm.to_jwk(_public_key))

# kid = JWK thumbprint (RFC 7638)
_thumbprint_src = json.dumps(
    {"e": _public_jwk["e"], "kty": _public_jwk["kty"], "n": _public_jwk["n"]},
    separators=(",", ":"),
    sort_keys=True,
)
KID = _b64url(sha256(_thumbprint_src.encode()).digest())


def get_jwks() -> dict:
    """Содержимое для /.well-known/jwks.json"""
    return {"keys": [{**_public_jwk, "kid": KID, "use": "sig", "alg": ALGORITHM}]}


# ---------------------------------------------------------------- JWT

def _now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def _encode(payload: dict) -> str:
    return jwt.encode(payload, _private_key, algorithm=ALGORITHM, headers={"kid": KID})


def create_access_token(
    user_id: str, user_name: str | None = "anon", role: str = "user"
) -> str:
    now = _now_utc()
    return _encode(
        {
            "iss": config.JWT_ISSUER,
            "type": "access",
            "sub": user_id,
            "nam": user_name,
            "roles": [role],
            "iat": now,
            "exp": now + config.ACCESS_TOKEN_TTL,
        }
    )


def create_refresh_token(user_id: str) -> tuple[str, str, datetime]:
    """Возвращает (token, jti, expires_at). Сохранение в БД — на вызывающем."""
    jti = str(uuid.uuid4())
    now = _now_utc()
    expires_at = now + config.REFRESH_TOKEN_TTL
    token = _encode(
        {
            "iss": config.JWT_ISSUER,
            "type": "refresh",
            "sub": user_id,
            "jti": jti,
            "iat": now,
            "exp": expires_at,
        }
    )
    return token, jti, expires_at


def decode_token(encoded_token: str) -> dict:
    try:
        return jwt.decode(
            encoded_token,
            _public_key,
            algorithms=[ALGORITHM],  # жёстко фиксируем алгоритм
            issuer=config.JWT_ISSUER,
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authorization header missing")
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Expected access token")
    return payload


# ---------------------------------------------------------------- Passwords
# Схема сохранена как в оригинале (sha256(pepper + sha256(password) + salt)),
# чтобы не сломать уже созданных пользователей.

def client_hash(password: str) -> str:
    return sha256(password.encode()).hexdigest()


def hash_with_salt_pepper(client_hash_: str, salt: str) -> str:
    return sha256((config.PEPPER_KEY + client_hash_ + salt).encode()).hexdigest()


def hash_new_password(password: str) -> tuple[str, str]:
    """Возвращает (final_hash, salt)."""
    import os

    salt = os.urandom(32).hex()
    return hash_with_salt_pepper(client_hash(password), salt), salt


def verify_password(password: str, salt: str, stored_hash: str) -> bool:
    candidate = hash_with_salt_pepper(client_hash(password), salt)
    return hmac.compare_digest(candidate, stored_hash)