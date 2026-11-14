import uuid

import fastapi
from fastapi import APIRouter, Cookie, Depends, Response
from fastapi.exceptions import HTTPException
from sqlalchemy.orm import Session

import config
import security
from models import get_db
from repos import MemberRepository, RefreshTokenRepository
from schemas import (
    AuthResponse,
    LoginRequest,
    MeResponse,
    OkResponse,
    RefreshResponse,
    RegisterRequest,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
wellknown_router = APIRouter(tags=["well-known"])


def _issue_session(
    response: Response, db: Session, user_id: str, user_name: str, role: str
) -> dict:
    """Создаёт refresh (в БД + cookie) и access токены."""
    token, jti, expires_at = security.create_refresh_token(user_id)
    RefreshTokenRepository(db).add(jti=jti, user_id=user_id, expires_at=expires_at)
    db.commit()

    response.set_cookie(
        key=config.REFRESH_COOKIE_NAME,
        value=token,
        samesite="lax",
        httponly=True,
        secure=config.COOKIE_SECURE,
        max_age=int(config.REFRESH_TOKEN_TTL.total_seconds()),
    )
    return {
        "ok": True,
        "id": user_id,
        "access_token": security.create_access_token(user_id, user_name, role),
        "token_type": "bearer",
    }


# ------------------------------------------------------------------ auth

@router.post("/register", response_model=AuthResponse)
async def register(
    body: RegisterRequest, response: Response, db: Session = Depends(get_db)
):
    members = MemberRepository(db)

    if members.name_exists(body.username):
        raise HTTPException(409, "User already exists")
    if members.email_exists(body.email):
        raise HTTPException(409, "Email already registered")

    user_id = str(uuid.uuid4())
    password_hash, salt = security.hash_new_password(body.password)

    members.create(
        user_id=user_id,
        email=body.email,
        name=body.username,
        password_hash=password_hash,
        salt=salt,
    )
    # MemberDataRepository(db).create_empty(user_id)
    db.commit()

    return _issue_session(response, db, user_id, body.username, "user")


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    member = MemberRepository(db).get_by_email(body.email)
    if not member or not security.verify_password(
        body.password, member.salt, member.password_hash
    ):
        raise HTTPException(401, "Wrong login or password")

    return _issue_session(response, db, member.id, member.name, member.role)


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_tokens(
    refresh_token: str | None = Cookie(alias=config.REFRESH_COOKIE_NAME, default=None),
    db: Session = Depends(get_db),
):
    if not refresh_token:
        raise HTTPException(400, "Refresh token not found")

    payload = security.decode_token(refresh_token)
    jti = payload.get("jti")
    user_id = payload.get("sub")
    _type = payload.get("type")

    if not _type:
        raise HTTPException(401, 'Invalid token: "type" not set')
    if _type != "refresh":
        raise HTTPException(401, 'Invalid token: "type" != "refresh"')
    if user_id is None:
        raise HTTPException(401, 'Invalid token: "user_id" aka "sub" not set')

    token_row = RefreshTokenRepository(db).get(jti) if jti else None
    if not token_row:
        raise HTTPException(401, "Token not found")
    if token_row.revoked:
        raise HTTPException(401, "Token revoked")

    member = MemberRepository(db).get_by_id(user_id)
    if not member:
        raise HTTPException(400, "There are no user with that token")

    # роль берётся из БД при каждом refresh -> смена роли применяется
    # не позже чем через ACCESS_TOKEN_TTL
    return {
        "access_token": security.create_access_token(user_id, member.name, member.role),
        "token_type": "bearer",
        "name": member.name,
    }


@router.post("/logout", response_model=OkResponse)
async def logout(
    response: Response,
    refresh_token: str | None = Cookie(
        alias=config.REFRESH_COOKIE_NAME,
        default=None,
    ),
    current_user: dict = Depends(security.get_current_user),
    db: Session = Depends(get_db),
):
    if refresh_token:
        try:
            payload = security.decode_token(refresh_token)
            RefreshTokenRepository(db).revoke(payload["jti"])
            db.commit()
        except Exception:
            pass

    response.delete_cookie(
        key=config.REFRESH_COOKIE_NAME,
        httponly=True,
        secure=config.COOKIE_SECURE,
        samesite="lax",
        path="/",
    )

    return {"ok": True}


@router.post("/logout_all", response_model=OkResponse)
async def logout_all(
    response: Response,
    current_user: dict = Depends(security.get_current_user),
    db: Session = Depends(get_db),
):
    RefreshTokenRepository(db).revoke_all_for_user(
        current_user["sub"]
    )
    db.commit()

    response.delete_cookie(
        key=config.REFRESH_COOKIE_NAME,
        httponly=True,
        secure=config.COOKIE_SECURE,
        samesite="lax",
        path="/",
    )

    return {"ok": True}


# @router.get("/me", response_model=MeResponse)
# async def get_my_data(
#     current_user: dict = Depends(security.get_current_user),
#     db: Session = Depends(get_db),
# ):
#     user_id = current_user["sub"]
#     user = MemberRepository(db).get_by_id(user_id)
#     if user is None:
#         raise HTTPException(404, "User not found")

#     data = MemberDataRepository(db).get(user_id)
#     return {
#         "ok": True,
#         "name": user.name,
#         "role": user.role,
#         "birthday": data.birthday if data else None,
#         "height": data.height if data else None,
#         "weight": data.weight if data else None,
#         "sex": data.sex if data else None,
#     }


# ------------------------------------------------------------------ misc

@wellknown_router.get("/.well-known/jwks.json")
async def jwks(response: Response):
    response.headers["Cache-Control"] = "public, max-age=3600"
    return security.get_jwks()
