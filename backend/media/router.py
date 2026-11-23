import logging
import os
import re

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

import fileloud_client as fl
from db import get_session
from jwks import get_required_user_id, require_recipe_manager
from models import UserAvatar

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/db", tags=["media"])

AVATAR_MAX_BYTES = int(os.getenv("AVATAR_MAX_BYTES", str(5 * 1024 * 1024)))
HYPERTEXT_MAX_BYTES = int(os.getenv("HYPERTEXT_MAX_BYTES", str(1024 * 1024)))
IMAGE_MAX_BYTES = int(os.getenv("IMAGE_MAX_BYTES", str(10 * 1024 * 1024)))
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}

# id файлов в fileloud — uuid4
_ID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")


def _error(code: int, state: str) -> JSONResponse:
    return JSONResponse(status_code=code, content={"code": code, "state": state})


async def _read_limited(file: UploadFile, limit: int) -> bytes | None:
    """Читает файл целиком; None, если он больше лимита."""
    data = await file.read(limit + 1)
    return None if len(data) > limit else data


# Публичный адрес сайта (nginx), например http://localhost.
# Задаётся один раз в .env в корне проекта, compose передаёт его сюда.
# Все ссылки в ответах собираются от него, поэтому их можно вставлять как есть:
# <img src="{image_url}"> откроется с любой страницы, без доп. обработки на фронте.
# Пусто — ссылки будут относительными (/api/db/...).
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")


def _public_url(path: str) -> str:
    return f"{PUBLIC_BASE_URL}/api/db/{path}"


def _avatar_url(file_id: str) -> str:
    return _public_url(f"avatar/{file_id}")


def _image_url(file_id: str) -> str:
    return _public_url(f"image/{file_id}")


def _hypertext_url(file_id: str) -> str:
    return _public_url(f"hyper-text/{file_id}")


# ---------- аватар ----------

@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Загрузка аватара текущего пользователя (multipart/form-data, поле file)."""
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        return _error(422, "Unprocessable Entity")
    data = await _read_limited(file, AVATAR_MAX_BYTES)
    if not data:
        return _error(422, "Unprocessable Entity")

    try:
        file_id = await fl.upload_image(data, file.filename or "avatar", file.content_type)
    except fl.FileloudError:
        logger.exception("fileloud upload failed")
        return _error(500, "Internal Server Error")

    await session.execute(
        pg_insert(UserAvatar)
        .values(user_id=user_id, file_id=file_id, content_type=file.content_type)
        .on_conflict_do_update(
            index_elements=["user_id"],
            set_={"file_id": file_id, "content_type": file.content_type},
        )
    )
    await session.commit()

    return {"avatar_url": _avatar_url(file_id), "code": 200, "state": "OK"}


async def _send_image(file_id: str) -> Response:
    try:
        data, content_type = await fl.get_item(file_id)
    except fl.FileloudNotFound:
        return _error(404, "Not Found")
    except fl.FileloudError:
        logger.exception("fileloud get failed")
        return _error(500, "Internal Server Error")
    if not content_type.startswith("image/"):
        return _error(404, "Not Found")
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/me/avatar")
async def get_my_avatar(
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Картинка аватара текущего пользователя (по токену)."""
    file_id = (
        await session.execute(select(UserAvatar.file_id).where(UserAvatar.user_id == user_id))
    ).scalar_one_or_none()
    if file_id is None:
        return _error(404, "Not Found")
    return await _send_image(file_id)


@router.get("/avatar/{file_id}")
async def get_avatar_by_id(
    file_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Публичная ссылка avatar_url — чтобы работал обычный <img src>, который не
    умеет слать Authorization. Отдаёт только файлы, которые реально являются чьим-то аватаром."""
    if not _ID_RE.match(file_id):
        return _error(404, "Not Found")
    exists = (
        await session.execute(select(UserAvatar.user_id).where(UserAvatar.file_id == file_id))
    ).scalar_one_or_none()
    if exists is None:
        return _error(404, "Not Found")
    return await _send_image(file_id)


# ---------- фото рецептов ----------

@router.post("/image")
async def upload_image(
    file: UploadFile = File(...),
    _claims: dict = Depends(require_recipe_manager),
):
    """Загрузка фото для рецепта (multipart/form-data, поле file).
    Только для тех, кто может управлять рецептами (как POST /api/db/recipes).
    Возвращённую ссылку кладём в поле image_url рецепта."""
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        return _error(422, "Unprocessable Entity")
    data = await _read_limited(file, IMAGE_MAX_BYTES)
    if not data:
        return _error(422, "Unprocessable Entity")

    try:
        file_id = await fl.upload_image(data, file.filename or "image", file.content_type)
    except fl.FileloudError:
        logger.exception("fileloud upload failed")
        return _error(500, "Internal Server Error")

    return JSONResponse(
        status_code=201,
        content={"image_url": _image_url(file_id), "code": 201, "state": "Created"},
    )


@router.get("/image/{file_id}")
async def get_image(file_id: str):
    """Фото рецепта, доступно всем без авторизации."""
    if not _ID_RE.match(file_id):
        return _error(404, "Not Found")
    return await _send_image(file_id)


# ---------- гипертекст рецептов ----------

@router.post("/hyper-text")
async def upload_hyper_text(
    file: UploadFile = File(...),
    _claims: dict = Depends(require_recipe_manager),
):
    """Загрузка html-страницы рецепта (multipart/form-data, поле file).
    Только для тех, кто может управлять рецептами (как POST /api/db/recipes).
    Возвращённую ссылку кладём в поле "hyper-text" рецепта."""
    data = await _read_limited(file, HYPERTEXT_MAX_BYTES)
    if not data:
        return _error(422, "Unprocessable Entity")
    try:
        html = data.decode("utf-8")
    except UnicodeDecodeError:
        return _error(422, "Unprocessable Entity")
    if not html.strip():
        return _error(422, "Unprocessable Entity")

    try:
        file_id = await fl.upload_html(html)
    except fl.FileloudError:
        logger.exception("fileloud upload failed")
        return _error(500, "Internal Server Error")

    return JSONResponse(
        status_code=201,
        content={"hyper-text": _hypertext_url(file_id), "code": 201, "state": "Created"},
    )


@router.get("/hyper-text/{file_id}")
async def get_hyper_text(file_id: str):
    """html-страница рецепта, доступна без авторизации."""
    if not _ID_RE.match(file_id):
        return _error(404, "Not Found")
    try:
        data, content_type = await fl.get_item(file_id)
    except fl.FileloudNotFound:
        return _error(404, "Not Found")
    except fl.FileloudError:
        logger.exception("fileloud get failed")
        return _error(500, "Internal Server Error")
    if not content_type.startswith("text/html"):
        return _error(404, "Not Found")
    return Response(content=data, media_type="text/html; charset=utf-8")
