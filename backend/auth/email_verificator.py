"""Клиент сервиса email_verificator (backend/email_verificator, контракт —
его README/api_contract: POST /api/mail/send, POST /api/mail/verify).

Сервис доступен только внутри docker-сети, наружу (через nginx) не торчит.
Ошибки сервиса пробрасываются как ApiError с тем же кодом и state.
"""
import logging

import httpx

import config
from errors import ApiError

logger = logging.getLogger(__name__)

# отправка письма через Gmail SMTP может занять несколько секунд
_TIMEOUT = httpx.Timeout(20.0, connect=5.0)
_UNAVAILABLE = ApiError(503, "Email verification service unavailable")


async def _post(path: str, payload: dict) -> tuple[int, dict]:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{config.EMAIL_VERIFICATOR_URL}{path}", json=payload)
    except httpx.HTTPError as exc:
        logger.warning("email_verificator %s недоступен: %r", path, exc)
        raise _UNAVAILABLE
    try:
        body = resp.json()
    except ValueError:
        body = {}
    return resp.status_code, body if isinstance(body, dict) else {}


def _raise_from(status: int, body: dict) -> None:
    # 400 / 404 / 410 / 429 / 503 из контракта верификатора — пробрасываем как есть
    if status in (400, 404, 410, 429, 503):
        raise ApiError(status, str(body.get("state") or "Error"))
    logger.warning("email_verificator ответил %s: %s", status, body)
    raise _UNAVAILABLE


async def send_code(email: str) -> None:
    """Просит верификатор сгенерировать код и отправить его на email."""
    status, body = await _post("/api/mail/send", {"email": email})
    if status != 200:
        _raise_from(status, body)


async def check_code(email: str, code: str) -> None:
    """Проверяет код. Ничего не возвращает, если код верный, иначе ApiError."""
    status, body = await _post(
        "/api/mail/verify", {"email": email, "verification_code": code}
    )
    if status != 200:
        _raise_from(status, body)
    if body.get("verification") is not True:
        raise ApiError(400, "Wrong verification code")
