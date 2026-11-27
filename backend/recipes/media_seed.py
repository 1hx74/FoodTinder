"""Фото и гипертекст для демо-рецептов.

Вызывается из seed.py только когда таблица recipes пуста:
1. ждём, пока поднимется fileloud;
2. качаем картинки по ссылкам из seed_content.py (параллельно, с ограничением);
3. кладём их в fileloud (POST /media/images);
4. собираем почти голый html с шагами и картинками и кладём его в fileloud
     (POST /media/texts);
5. отдаём относительные ссылки /api/db/image/{id} и /api/db/hyper-text/{id}.

Любая ошибка (нет интернета, fileloud лежит) не роняет старт: рецепты всё равно
создаются, а в лог пишется warning. Если не удалось сохранить главное фото —
в image_url кладём ссылку на источник; если фото шага — шаг остаётся без картинки.
"""
import asyncio
import html
import logging
import os
import time

import httpx

from public_urls import media_url
from seed_content import RECIPE_MEDIA

logger = logging.getLogger("uvicorn.error")

FILELOUD_URL = os.getenv("FILELOUD_URL", "http://fileloud:8000").rstrip("/")
SEED_MEDIA = os.getenv("SEED_MEDIA", "true").lower() == "true"
FILELOUD_WAIT_SECONDS = float(os.getenv("FILELOUD_WAIT_SECONDS", "60"))
CONCURRENCY = 8
MAX_IMAGE_BYTES = 10 * 1024 * 1024

_USER_AGENT = "Mozilla/5.0 (compatible; FoodTinder-seed/1.0)"
_EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}

# Стили для компактного отображения шагов и картинок без лишних отступов
_STYLE = (
    '.ft-steps{font-family:var(--main-font, "Inter-Bold", sans-serif);font-size:14px;line-height:1.4;'
    "color:#222222;width:100%;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}"
    ".ft-steps h3{font-size:14px;font-weight:700;color:#000000;margin:0 0 4px}"
    ".ft-steps p{font-size:14px;font-weight:400;line-height:1.4;color:#222222;margin:0;padding:0}"
    ".ft-steps .step{margin:0;padding:0;display:flex;flex-direction:column;gap:6px}"
    ".ft-steps img{display:block;max-width:100%;height:auto;border-radius:12px;margin:4px 0 0 0}"
)


def public_image_url(file_id: str) -> str:
    return media_url("image", file_id)


def public_hypertext_url(file_id: str) -> str:
    return media_url("hyper-text", file_id)


def _file_id(fileloud_url: str) -> str:
    # fileloud отвечает {"url": "<BASE_URL>/uploads/<id>"}
    return fileloud_url.rstrip("/").rsplit("/", 1)[-1]


def build_html(title: str, steps: list[tuple[str, str | None]]) -> str:
    """steps: [(текст, ссылка на картинку или None)]."""
    parts = [f'<article class="ft-steps">', f"<style>{_STYLE}</style>"]
    for n, (text, img) in enumerate(steps, start=1):
        parts.append('<section class="step">')
        parts.append(f"<h3>Шаг {n}</h3>")
        parts.append(f"<p>{html.escape(text)}</p>")
        if img:
            parts.append(f'<img src="{html.escape(img)}" alt="Шаг {n}" loading="lazy">')
        parts.append("</section>")
    parts.append("</article>")
    return "\n".join(parts) + "\n"


async def _wait_fileloud(client: httpx.AsyncClient) -> bool:
    """fileloud стартует после minio и может подниматься не сразу — ждём."""
    deadline = time.monotonic() + FILELOUD_WAIT_SECONDS
    while True:
        try:
            r = await client.get(f"{FILELOUD_URL}/openapi.json", timeout=3)
            if r.status_code == 200:
                return True
        except httpx.HTTPError:
            pass
        if time.monotonic() >= deadline:
            return False
        await asyncio.sleep(2)


async def _download(client: httpx.AsyncClient, url: str) -> tuple[bytes, str]:
    last_err: Exception | None = None
    for attempt in range(2):
        try:
            r = await client.get(url, headers={"User-Agent": _USER_AGENT})
            ctype = r.headers.get("content-type", "").split(";")[0].strip().lower()
            if ctype == "image/jpg":
                ctype = "image/jpeg"
            if r.status_code != 200:
                raise ValueError(f"HTTP {r.status_code}")
            if ctype not in _EXT:
                raise ValueError(f"не картинка: {ctype or '?'}")
            if not r.content or len(r.content) > MAX_IMAGE_BYTES:
                raise ValueError(f"размер {len(r.content)} байт")
            return r.content, ctype
        except (httpx.HTTPError, ValueError) as e:
            last_err = e
            if attempt == 0:
                await asyncio.sleep(1)
    raise RuntimeError(f"{url}: {last_err}")


async def _store_image(client: httpx.AsyncClient, sem: asyncio.Semaphore, url: str,
                       name: str) -> str | None:
    """Скачать картинку и положить в fileloud. Возвращает публичную ссылку или None."""
    async with sem:
        try:
            data, ctype = await _download(client, url)
            r = await client.post(
                f"{FILELOUD_URL}/media/images",
                files={"file": (name + _EXT[ctype], data, ctype)},
            )
            if r.status_code != 200:
                raise RuntimeError(f"fileloud {r.status_code}: {r.text[:200]}")
            return public_image_url(_file_id(r.json()["url"]))
        except Exception as e:  # noqa: BLE001 — сид не должен ронять старт
            logger.warning("seed media: картинка не сохранена (%s): %s", url, e)
            return None


async def _store_html(client: httpx.AsyncClient, page: str) -> str | None:
    try:
        r = await client.post(f"{FILELOUD_URL}/media/texts", data={"html_content": page})
        if r.status_code != 200:
            raise RuntimeError(f"fileloud {r.status_code}: {r.text[:200]}")
        return public_hypertext_url(_file_id(r.json()["url"]))
    except Exception as e:  # noqa: BLE001
        logger.warning("seed media: гипертекст не сохранён: %s", e)
        return None


async def _one_recipe(client, sem, n: int, title: str, info: dict) -> tuple[str, str | None]:
    tasks = [_store_image(client, sem, info["photo"], f"recipe{n}")]
    tasks += [_store_image(client, sem, img, f"recipe{n}_step{i}")
              for i, (_text, img) in enumerate(info["steps"], start=1)]
    photo, *step_imgs = await asyncio.gather(*tasks)
    steps = [(text, img) for (text, _src), img in zip(info["steps"], step_imgs)]
    hypertext = await _store_html(client, build_html(title, steps))
    ok = sum(1 for i in step_imgs if i) + (1 if photo else 0)
    logger.info("seed media: %s — картинок %d/%d, гипертекст %s",
                title, ok, len(tasks), "ok" if hypertext else "нет")
    # главное фото не сохранилось — хотя бы ссылка на оригинал
    return photo or info["photo"], hypertext


async def build_media(titles: list[str]) -> dict[str, tuple[str, str | None]]:
    """title -> (image_url, hypertext_url | None) для рецептов из seed_content.py.
    SEED_MEDIA=false — ничего не качаем, image_url = ссылка на фото источника."""
    todo = [(n, t) for n, t in enumerate(titles, start=1) if t in RECIPE_MEDIA]
    if not SEED_MEDIA:
        return {t: (RECIPE_MEDIA[t]["photo"], None) for _n, t in todo}
    result: dict[str, tuple[str, str | None]] = {}
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=5.0), follow_redirects=True,
        ) as client:
            if not await _wait_fileloud(client):
                logger.warning("seed media: fileloud (%s) недоступен — рецепты будут "
                               "со ссылками на фото источника и без гипертекста", FILELOUD_URL)
                return {t: (RECIPE_MEDIA[t]["photo"], None) for _n, t in todo}
            sem = asyncio.Semaphore(CONCURRENCY)
            done = await asyncio.gather(
                *(_one_recipe(client, sem, n, t, RECIPE_MEDIA[t]) for n, t in todo)
            )
            result = {t: urls for (_n, t), urls in zip(todo, done)}
    except Exception:  # noqa: BLE001
        logger.exception("seed media: ошибка, рецепты будут без фото из хранилища")
        return {t: (RECIPE_MEDIA[t]["photo"], None) for _n, t in todo}
    logger.info("seed media: готово за %.1f с", time.monotonic() - started)
    return result