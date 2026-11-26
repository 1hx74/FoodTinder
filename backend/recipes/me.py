"""Эндпоинты текущего пользователя: GET /api/db/me и GET/PATCH /api/db/me/preferences.

Аватар (/api/db/me/avatar) — в сервисе media, nginx отправляет его туда.

Данные пользователя лежат в общей БД у разных сервисов:
  members          — auth    (имя, почта, роль, дата регистрации)
  user_avatars     — media   (id файла аватара в fileloud)
  user_preferences — recipes (фильтры: аллергии, диеты, религия, оборудование)
  user_profiles    — recipes (анкета: дата рождения, пол, рост, вес)
GET /api/db/me собирает их в один ответ, PATCH /api/db/me меняет имя и анкету.
"""
import functools
import logging
import os
from datetime import date

from fastapi import APIRouter, Depends, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_session
from jwks import get_required_user_id
from models import UserPreferences, UserProfile
from vocab import ALLERGY_CODES, DIET_CODES, EQUIPMENT_CODES, RELIGION_CODES, clean_codes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/db/me", tags=["me"])

# Публичный адрес сайта (из .env в корне проекта) — для абсолютной ссылки avatar_url,
# как у сервиса media.
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")


def _error(code: int, state: str) -> JSONResponse:
    return JSONResponse(status_code=code, content={"code": code, "state": state})


def handle_db_errors(func):
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except SQLAlchemyError:
            logger.exception("database error")
            return _error(500, "Internal Server Error")

    return wrapper


# ---------- предпочтения ----------

async def load_preferences(session: AsyncSession, user_id: str) -> dict[str, list[str]]:
    """Сохранённые фильтры пользователя; ничего не сохранял -> пустые списки."""
    row = (
        await session.execute(select(UserPreferences).where(UserPreferences.user_id == user_id))
    ).scalar_one_or_none()
    if row is None:
        return {"allergies": [], "diets": [], "religions": [], "kitchen_equipment": []}
    return {
        "allergies": list(row.allergies or []),
        "diets": list(row.diets or []),
        "religions": list(row.religions or []),
        "kitchen_equipment": list(row.kitchen_equipment or []),
    }


class PreferencesPatch(BaseModel):
    """Каждое поле необязательно: не прислали -> не меняется,
    прислали список -> он ЗАМЕНЯЕТ сохранённый целиком ([] — очистить)."""

    allergies: list[str] | None = Field(
        default=None, max_length=50,
        description="аллергии: " + ", ".join(ALLERGY_CODES),
    )
    diets: list[str] | None = Field(
        default=None, max_length=10,
        description="диеты: " + ", ".join(DIET_CODES),
    )
    religions: list[str] | None = Field(
        default=None, max_length=10,
        description="религия: " + ", ".join(RELIGION_CODES),
    )
    kitchen_equipment: list[str] | None = Field(
        default=None, max_length=50,
        description="оборудование: " + ", ".join(EQUIPMENT_CODES),
    )


_PREF_VOCAB = {
    "allergies": ALLERGY_CODES,
    "diets": DIET_CODES,
    "religions": RELIGION_CODES,
    "kitchen_equipment": EQUIPMENT_CODES,
}


@router.get("/preferences")
@handle_db_errors
async def get_preferences(
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Фильтры пользователя: {allergies, diets, religions, kitchen_equipment}."""
    return await load_preferences(session, user_id)


@router.patch("/preferences")
@handle_db_errors
async def patch_preferences(
    body: PreferencesPatch,
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Сохранить фильтры. Неизвестный код -> 422."""
    values: dict[str, list[str]] = {}
    for field, allowed in _PREF_VOCAB.items():
        raw = getattr(body, field)
        if raw is None:
            continue
        try:
            values[field] = clean_codes(raw, allowed, field)
        except ValueError:
            return _error(422, "Unprocessable Entity")

    if values:
        await session.execute(
            pg_insert(UserPreferences)
            .values(user_id=user_id, **values)
            .on_conflict_do_update(
                index_elements=["user_id"],
                set_={**values, "updated_at": text("now()")},
            )
        )
        await session.commit()
    return {"code": 200, "state": "OK"}


# ---------- профиль ----------

GENDERS = ("men", "women")
USERNAME_MAX = 32  # как в auth (schemas.RegisterRequest)
HEIGHT_RANGE = (50, 250)  # см
WEIGHT_RANGE = (20, 300)  # кг


async def _table_exists(session: AsyncSession, name: str) -> bool:
    return (
        await session.execute(text("SELECT to_regclass(:n) IS NOT NULL"), {"n": f"public.{name}"})
    ).scalar_one()


async def _get_member(session: AsyncSession, user_id: str):
    if not await _table_exists(session, "members"):
        return None
    return (
        await session.execute(
            text("SELECT id, name, email, role, created_at FROM members WHERE id = :id"),
            {"id": user_id},
        )
    ).mappings().one_or_none()


@router.get("")
@handle_db_errors
async def get_me(
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Всё о текущем пользователе одним запросом (вместо /me/short)."""
    member = await _get_member(session, user_id)
    if member is None:
        return _error(404, "Not Found")

    avatar_url = None
    if await _table_exists(session, "user_avatars"):
        file_id = (
            await session.execute(
                text("SELECT file_id FROM user_avatars WHERE user_id = :id"), {"id": user_id}
            )
        ).scalar_one_or_none()
        if file_id:
            avatar_url = f"{PUBLIC_BASE_URL}/api/db/avatar/{file_id}"

    profile = (
        await session.execute(select(UserProfile).where(UserProfile.user_id == user_id))
    ).scalar_one_or_none()

    created_at = member["created_at"]
    return {
        "user_id": member["id"],
        "username": member["name"],
        "email": member["email"],
        "avatar_url": avatar_url,
        # анкета; не заполнено -> null
        "birth_date": profile.birth_date.isoformat() if profile and profile.birth_date else None,
        "gender": profile.gender if profile else None,
        "height": profile.height if profile else None,
        "weight": profile.weight if profile else None,
        "role": member["role"] or "user",
        "created_at": created_at.isoformat() if created_at else None,
        "preferences": await load_preferences(session, user_id),
        "code": 200,
        "state": "OK",
    }


class ProfilePatch(BaseModel):
    """Все поля необязательны: не прислали (или null) -> не меняется.
    Лишние поля (например avatar_url) игнорируются — аватар грузится через POST /api/db/me/avatar."""

    username: str | None = Field(default=None, description=f"1..{USERNAME_MAX} символов, уникальное")
    birth_date: str | None = Field(default=None, description="ГГГГ-ММ-ДД, не в будущем")
    gender: str | None = Field(default=None, description="men / women")
    height: int | None = Field(default=None, description=f"рост, см: {HEIGHT_RANGE[0]}..{HEIGHT_RANGE[1]}")
    weight: int | None = Field(default=None, description=f"вес, кг: {WEIGHT_RANGE[0]}..{WEIGHT_RANGE[1]}")


def _validate_profile(body: ProfilePatch) -> tuple[str | None, dict] | None:
    """(новое имя или None, поля анкеты) или None, если что-то невалидно."""
    username = None
    if body.username is not None:
        username = body.username.strip()
        if not username or len(username) > USERNAME_MAX:
            return None

    fields: dict = {}
    if body.birth_date is not None:
        try:
            birth = date.fromisoformat(body.birth_date.strip())
        except ValueError:
            return None
        if birth > date.today() or birth.year < 1900:
            return None
        fields["birth_date"] = birth
    if body.gender is not None:
        if body.gender not in GENDERS:
            return None
        fields["gender"] = body.gender
    if body.height is not None:
        if not HEIGHT_RANGE[0] <= body.height <= HEIGHT_RANGE[1]:
            return None
        fields["height"] = body.height
    if body.weight is not None:
        if not WEIGHT_RANGE[0] <= body.weight <= WEIGHT_RANGE[1]:
            return None
        fields["weight"] = body.weight
    return username, fields


async def _username_taken(session: AsyncSession, name: str, user_id: str) -> bool:
    taken = (
        await session.execute(
            text("SELECT 1 FROM members WHERE name = :n AND id <> :id"), {"n": name, "id": user_id}
        )
    ).first() is not None
    # имя, занятое незавершённой регистрацией (ждёт код с почты), auth тоже считает занятым
    if not taken and await _table_exists(session, "pending_registrations"):
        taken = (
            await session.execute(
                text("SELECT 1 FROM pending_registrations WHERE name = :n AND expires_at > now()"),
                {"n": name},
            )
        ).first() is not None
    return taken


@router.patch("")
@handle_db_errors
async def patch_me(
    body: ProfilePatch,
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Изменить имя и/или анкету. Частичное обновление."""
    member = await _get_member(session, user_id)
    if member is None:
        return _error(404, "Not Found")

    checked = _validate_profile(body)
    if checked is None:
        return _error(422, "Unprocessable Entity")
    username, fields = checked

    try:
        if username is not None and username != member["name"]:
            if await _username_taken(session, username, user_id):
                return _error(409, "User already exists")
            await session.execute(
                text("UPDATE members SET name = :n WHERE id = :id"), {"n": username, "id": user_id}
            )
        if fields:
            await session.execute(
                pg_insert(UserProfile)
                .values(user_id=user_id, **fields)
                .on_conflict_do_update(
                    index_elements=["user_id"],
                    set_={**fields, "updated_at": text("now()")},
                )
            )
        await session.commit()
    except IntegrityError:
        # имя заняли параллельно (members.name UNIQUE)
        await session.rollback()
        return _error(409, "User already exists")
    return {"code": 200, "state": "OK"}


async def validation_error_handler(request: Request, exc: RequestValidationError):
    """Ошибки типов в теле PATCH /api/db/me -> 422 {code, state}, как остальные ошибки
    этого эндпоинта. Для всех остальных эндпоинтов — стандартный ответ FastAPI."""
    if request.method == "PATCH" and request.url.path.rstrip("/") == router.prefix:
        return _error(422, "Unprocessable Entity")
    return await request_validation_exception_handler(request, exc)
