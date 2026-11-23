import uuid
from datetime import datetime

import fastapi
from fastapi import APIRouter, Cookie, Depends, Response
from fastapi.exceptions import HTTPException
from sqlalchemy.orm import Session

import config
import email_verificator
import security
from errors import ApiError
from models import get_db
from repos import MemberRepository, PendingRepository, RefreshTokenRepository
from schemas import (
    AuthResponse,
    LoginRequest,
    MeResponse,
    OkResponse,
    PasswordRecoverRequest,
    PasswordRecoverVerifyRequest,
    RefreshResponse,
    RegisterRequest,
    RegisterVerifyRequest,
    StateResponse,
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

# --- регистрация в 2 шага: данные -> код с почты -> только тогда запись в members

@router.post(
    "/register",
    response_model=StateResponse,
    responses={409: {"model": StateResponse}, 400: {"model": StateResponse},
               429: {"model": StateResponse}, 503: {"model": StateResponse}},
)
async def register(body: RegisterRequest, db: Session = Depends(get_db)):
    """Шаг 1: проверяет данные, запоминает регистрацию и шлёт код на почту.
    В members пользователь НЕ попадает, пока код не подтверждён (/register/verify)."""
    members = MemberRepository(db)
    pending = PendingRepository(db)
    pending.purge_expired()

    if members.name_exists(body.username) or pending.name_pending(body.username, body.email):
        raise ApiError(409, "User already exists")
    if members.email_exists(body.email):
        raise ApiError(409, "Email already registered")

    password_hash, salt = security.hash_new_password(body.password)
    pending.put_registration(
        email=body.email,
        name=body.username,
        password_hash=password_hash,
        salt=salt,
        expires_at=datetime.now() + config.PENDING_TTL,
    )
    try:
        await email_verificator.send_code(body.email)
    except ApiError:
        db.rollback()
        raise
    db.commit()
    return {"code": 200, "state": "OK"}


@router.post(
    "/register/verify",
    response_model=AuthResponse,
    responses={400: {"model": StateResponse}, 404: {"model": StateResponse},
               409: {"model": StateResponse}, 410: {"model": StateResponse},
               429: {"model": StateResponse}, 503: {"model": StateResponse}},
)
async def register_verify(
    body: RegisterVerifyRequest, response: Response, db: Session = Depends(get_db)
):
    """Шаг 2: проверяет код с почты, создаёт пользователя и сразу логинит его."""
    pending = PendingRepository(db)
    reg = pending.get_registration(body.email)
    if reg is None:
        raise ApiError(404, "Registration not found")

    await email_verificator.check_code(body.email, body.code)

    members = MemberRepository(db)
    # пока ждали код, имя/почту мог занять кто-то другой
    if members.name_exists(reg.name):
        pending.delete_registration(body.email)
        db.commit()
        raise ApiError(409, "User already exists")
    if members.email_exists(reg.email):
        pending.delete_registration(body.email)
        db.commit()
        raise ApiError(409, "Email already registered")

    user_id = str(uuid.uuid4())
    name = reg.name
    members.create(
        user_id=user_id,
        email=reg.email,
        name=name,
        password_hash=reg.password_hash,
        salt=reg.salt,
    )
    pending.delete_registration(body.email)
    # MemberDataRepository(db).create_empty(user_id)
    db.commit()

    return _issue_session(response, db, user_id, name, "user")


# --- восстановление пароля в 2 шага: почта + новый пароль -> код с почты -> смена

@router.post(
    "/password/recover",
    response_model=StateResponse,
    responses={400: {"model": StateResponse}, 404: {"model": StateResponse},
               429: {"model": StateResponse}, 503: {"model": StateResponse}},
)
async def password_recover(body: PasswordRecoverRequest, db: Session = Depends(get_db)):
    """Шаг 1: запоминает новый пароль и шлёт код на почту. Пароль ещё НЕ меняется."""
    pending = PendingRepository(db)
    pending.purge_expired()

    if not MemberRepository(db).email_exists(body.email):
        # Скрывать нет смысла: /register и так отвечает 409 на занятую почту
        raise ApiError(404, "User not found")

    password_hash, salt = security.hash_new_password(body.new_password)
    pending.put_reset(
        email=body.email,
        password_hash=password_hash,
        salt=salt,
        expires_at=datetime.now() + config.PENDING_TTL,
    )
    try:
        await email_verificator.send_code(body.email)
    except ApiError:
        db.rollback()
        raise
    db.commit()
    return {"code": 200, "state": "OK"}


@router.post(
    "/password/recover/verify",
    response_model=StateResponse,
    responses={400: {"model": StateResponse}, 404: {"model": StateResponse},
               410: {"model": StateResponse}, 429: {"model": StateResponse},
               503: {"model": StateResponse}},
)
async def password_recover_verify(
    body: PasswordRecoverVerifyRequest, db: Session = Depends(get_db)
):
    """Шаг 2: проверяет код, ставит новый пароль и разлогинивает все сессии."""
    pending = PendingRepository(db)
    reset = pending.get_reset(body.email)
    if reset is None:
        raise ApiError(404, "Password recovery not found")

    await email_verificator.check_code(body.email, body.code)

    members = MemberRepository(db)
    member = members.get_by_email(body.email)
    if member is None:
        pending.delete_reset(body.email)
        db.commit()
        raise ApiError(404, "User not found")

    members.set_password(member.id, reset.password_hash, reset.salt)
    RefreshTokenRepository(db).revoke_all_for_user(member.id)
    pending.delete_reset(body.email)
    db.commit()
    return {"code": 200, "state": "OK"}


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
