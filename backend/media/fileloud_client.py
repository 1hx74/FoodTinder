"""Клиент к внутреннему сервису fileloud (S3-хранилище файлов).
fileloud наружу не опубликован, ходим к нему только по docker-сети."""
import os

import httpx

FILELOUD_URL = os.getenv("FILELOUD_URL", "http://fileloud:8000").rstrip("/")
_TIMEOUT = httpx.Timeout(30.0)


class FileloudError(Exception):
    """fileloud недоступен или ответил ошибкой."""


class FileloudNotFound(FileloudError):
    pass


def _item_id_from_url(url: str) -> str:
    # fileloud отвечает {"url": "<BASE_URL>/uploads/<id>"}
    return url.rstrip("/").rsplit("/", 1)[-1]


async def upload_image(data: bytes, filename: str, content_type: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(
                f"{FILELOUD_URL}/media/images",
                files={"file": (filename, data, content_type)},
            )
    except httpx.HTTPError as e:
        raise FileloudError(str(e)) from e
    if r.status_code != 200:
        raise FileloudError(f"fileloud {r.status_code}: {r.text[:200]}")
    return _item_id_from_url(r.json()["url"])


async def upload_html(html: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(f"{FILELOUD_URL}/media/texts", data={"html_content": html})
    except httpx.HTTPError as e:
        raise FileloudError(str(e)) from e
    if r.status_code != 200:
        raise FileloudError(f"fileloud {r.status_code}: {r.text[:200]}")
    return _item_id_from_url(r.json()["url"])


async def get_item(item_id: str) -> tuple[bytes, str]:
    """Возвращает (содержимое, content-type)."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(f"{FILELOUD_URL}/uploads/{item_id}")
    except httpx.HTTPError as e:
        raise FileloudError(str(e)) from e
    if r.status_code == 404:
        raise FileloudNotFound(item_id)
    if r.status_code != 200:
        raise FileloudError(f"fileloud {r.status_code}: {r.text[:200]}")
    return r.content, r.headers.get("content-type", "application/octet-stream")
