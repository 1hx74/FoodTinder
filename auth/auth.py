import os
import json
from datetime import timedelta
from dotenv import load_dotenv
import mimetypes
import fastapi
import uvicorn
import hashlib
import uuid
import jwt
from hashlib import sha256
from typing import Literal
from urllib.parse import quote
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi import Limiter, _rate_limit_exceeded_handler
from datetime import datetime, timedelta, timezone
from fastapi import (
    WebSocket,
    WebSocketDisconnect,
    Depends,
    Response,
    Cookie,
    UploadFile,
    File,
)
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from models import *
from sqlalchemy import Engine, create_engine, select, update
from sqlalchemy.orm import Session, sessionmaker
load_dotenv()

auth_app = fastapi.FastAPI()
auth_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

bearer_scheme = HTTPBearer(auto_error=False)

## -- DB 

POSTGRES_USER = os.environ["POSTGRES_USER"]
POSTGRES_PASSWORD = os.environ["POSTGRES_PASSWORD"]
POSTGRES_DB = os.environ["POSTGRES_DB"]
POSTGRES_HOST = os.environ.get("POSTGRES_HOST", "localhost")
POSTGRES_PORT = os.environ.get("POSTGRES_PORT", "5432")

DB_PATH = (
    f"postgresql+psycopg://{POSTGRES_USER}:{POSTGRES_PASSWORD}"
    f"@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
)

engine: Engine
SessionLocal: sessionmaker

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


## -- ENV


SECRET_KEY = os.environ.get("SECRET_KEY", "change_me_in_production_please_for_32+_char_password")
PEPPER_KEY = os.environ.get("PEPPER_KEY", "change_me_in_production_please")
ALGORITHM = "HS256"
ACCESS_TOKEN_TTL = timedelta(minutes=15)
REFRESH_TOKEN_TTL = timedelta(days=30)


## -- JWT токены и иже с ними

def _now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def create_token(user_id: str, user_name: str | None = "anon"):
    now = _now_utc()
    data = {
        "iss": "food-tinder-jwt-vendor",
        "type": "access",
        "sub": user_id,
        "nam": user_name,
        "iat": now,
        "exp": now + ACCESS_TOKEN_TTL,
    }
    return jwt.encode(data, SECRET_KEY, ALGORITHM)


def create_refresh_token(user_id: str, db: Session) -> str:
    jti = str(uuid.uuid4())
    iat = _now_utc()
    expires_at = iat + REFRESH_TOKEN_TTL
    data = {
        "sub": user_id,
        "type": "refresh",
        "jti": jti,
        "iat": iat,
        "exp": expires_at,
    }
    token = jwt.encode(data, SECRET_KEY, ALGORITHM)

    db.add(RefreshToken(jti=jti, user_id=user_id, expires_at=expires_at))
    db.commit()

    return token


def decode_token(encoded_token: str) -> dict:
    try:
        return jwt.decode(encoded_token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


def revoke_token(jti: str, db: Session) -> None:
    db.execute(update(RefreshToken).where(RefreshToken.jti == jti).values(revoked=True))
    db.commit()



## -- API

def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authorization header missing")
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Expected access token")
    return payload

def hash_with_salt_pepper(client_hash: str, salt: str) -> str:
    combined = PEPPER_KEY + client_hash + salt
    return sha256(combined.encode()).hexdigest()


@auth_app.post("/api/auth/register")
async def register(
    request: fastapi.Request, response: Response, db: Session = Depends(get_db)
) -> dict:
    raw_body = await request.body()
    body = json.loads(raw_body)
    email = body.get("email")
    username = body.get("username")
    password = body.get("password")

    password_hash = sha256(password.encode()).hexdigest()

    if not password_hash:
        raise HTTPException(status_code=400, detail="password missing")

    if not username or len(username) > 32:
        raise HTTPException(status_code=400, detail="name missing or its length is wrong")

    if not email or len(email) > 320 or len(email) < 1:
        raise HTTPException(status_code=400, detail="email missing or its length is wrong")

    existing = db.execute(select(Member.id).where(Member.name == username)).scalar()
    if existing:
        raise HTTPException(status_code=409, detail="User already exists")

    user_id = str(uuid.uuid4())
    salt = os.urandom(32).hex()
    final_hash = hash_with_salt_pepper(password_hash, salt)

    db.add(
        Member(
            id=user_id,
            email=email,
            password_hash=final_hash,
            name=username,
            salt=salt,
            created_at=datetime.now(),
        )
    )
    db.commit()

    response.set_cookie(
        key="refresh-token",
        value=create_refresh_token(user_id, db),
        samesite="lax",
        httponly=True,
        secure=True,
        max_age=60 * 60 * 24 * 30,
    )

    return {
        "ok": True,
        "id": user_id,
        "access_token": create_token(user_id, username),
        "token_type": "bearer",
    }


@auth_app.post("/api/auth/login")
async def login(
    request: fastapi.Request, response: Response, db: Session = Depends(get_db)
) -> dict:
    raw_body = await request.body()
    body = json.loads(raw_body)
    username = body.get("username")
    password = body.get("password")

    if not password:
        raise HTTPException(400, "password missing")
    if not username or len(username) > 32:
        raise HTTPException(400, "Invalid username")


    password_hash = sha256(password.encode()).hexdigest()
    row = db.execute(select(Member).where(Member.name == username)).scalar_one_or_none()
    if not row:
        raise HTTPException(401, "Wrong login or password")

    final_hash = hash_with_salt_pepper(password_hash, row.salt)
    if final_hash != row.password_hash:
        raise HTTPException(401, "Wrong login or password")

    user_id = row.id
    user_name = row.name

    response.set_cookie(
        key="refresh-token",
        value=create_refresh_token(user_id, db),
        samesite="lax",
        httponly=True,
        secure=True,
        max_age=60 * 60 * 24 * 30,
    )
    return {
        "ok": True,
        "id": user_id,
        "access_token": create_token(user_id, user_name),
        "token_type": "bearer",
    }


@auth_app.post("/api/auth/refresh")
async def refresh_tokens(
    request: fastapi.Request,
    refresh_token: str | None = Cookie(alias="refresh-token", default=None),
    db: Session = Depends(get_db),
) -> dict:
    if not refresh_token:
        raise HTTPException(400, "Refresh token not found")

    payload = decode_token(refresh_token)
    jti = payload.get("jti")
    user_id = payload.get("sub")
    _type = payload.get("type")

    if not _type or _type != "refresh" or user_id is None:
        if not _type:
            raise HTTPException(401, 'Invalid token: "type" not set')
        if _type != "refresh":
            raise HTTPException(401, 'Invalid token: "type" != "refresh"')
        if user_id is None:
            raise HTTPException(401, 'Invalid token: "user_id" aka "sub" not set')

    token_row = db.execute(
        select(RefreshToken).where(RefreshToken.jti == jti)
    ).scalar_one_or_none()

    if not token_row:
        raise HTTPException(status_code=401, detail="Token not found")
    if token_row.revoked:
        raise HTTPException(status_code=401, detail="Token revoked")

    user_name = db.execute(
        select(Member.name).where(Member.id == user_id)
    ).scalar_one_or_none()

    if not user_name:
        raise HTTPException(400, "There are no user with that token")

    return {
        "access_token": create_token(user_id, user_name),
        "token_type": "bearer",
        "name": user_name,
    }


@auth_app.post("/api/auth/logout")
async def logout(
    request: fastapi.Request,
    refresh_token: str | None = Cookie(alias="refresh-token", default=None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not refresh_token:
        raise HTTPException(400, "Refresh token not found")
    try:
        payload = decode_token(refresh_token)
        revoke_token(payload.get("jti", ""), db)
    except Exception:
        pass
    return {"ok": True}


@auth_app.post("/api/auth/logout_all")
async def logout_all(
    request: fastapi.Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    db.execute(
        update(RefreshToken).where(RefreshToken.user_id == current_user["sub"]).values(revoked=True)
    )
    db.commit()
    return {"ok": True}

@auth_app.get("/api/user_database/me")
async def get_my_data(
    request: fastapi.Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_id = current_user['sub']
    user = db.execute(
        select(Member).where(Member.id == user_id)
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(404, "User not found")
    
    user_data = db.execute(
        select(MemberData).where(MemberData.id == user_id)
    ).scalar_one()

    return {
        "ok": True,
        "name": user.name,
        "birthday" : user_data.birthday,
        "height": user_data.height,
        "weight": user_data.weight,
        "sex": user_data.sex
    }

@auth_app.get("/")
async def foo():
    return {"Hello, Food-Tinder"} 

def main():
    global engine, SessionLocal

    engine = create_engine(DB_PATH)
    Base.metadata.create_all(engine)   # создаёт таблицы, если их ещё нет
    SessionLocal = sessionmaker(bind=engine)

    uvicorn.run(auth_app, host="0.0.0.0", port=8000)

if __name__ == "__main__":
    main()