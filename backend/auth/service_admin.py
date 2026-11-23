"""Служебный аккаунт для проверок (чтобы не регистрироваться после каждого сноса БД).

Почта и пароль задаются в .env в КОРНЕ проекта (SERVICE_ADMIN_EMAIL /
SERVICE_ADMIN_PASSWORD), compose прокидывает их в auth. Если хоть одно пустое —
аккаунт не создаётся. Создаётся при старте auth с ролью admin, без кода с почты.
Если аккаунт уже есть — пароль и роль приводятся к значениям из .env
(поменял пароль в .env -> перезапусти auth).
"""
import logging
import uuid

import config
import security
from models import SessionLocal
from repos import MemberRepository

logger = logging.getLogger("uvicorn.error")


def _free_name(members: MemberRepository, base: str) -> str:
    name, i = base, 1
    while members.name_exists(name):
        name = f"{base}_{i}"
        i += 1
    return name


def ensure_service_admin() -> None:
    email = config.SERVICE_ADMIN_EMAIL
    password = config.SERVICE_ADMIN_PASSWORD
    if not email or not password:
        logger.info("service admin: SERVICE_ADMIN_EMAIL/PASSWORD не заданы — не создаётся")
        return

    with SessionLocal() as db:
        members = MemberRepository(db)
        member = members.get_by_email(email)

        if member is None:
            password_hash, salt = security.hash_new_password(password)
            name = _free_name(members, "admin")
            members.create(
                user_id=str(uuid.uuid4()),
                email=email,
                name=name,
                password_hash=password_hash,
                salt=salt,
                role="admin",
            )
            db.commit()
            logger.info("service admin: создан %s (имя %s)", email, name)
            return

        changed = False
        if not security.verify_password(password, member.salt, member.password_hash):
            member.password_hash, member.salt = security.hash_new_password(password)
            changed = True
        if member.role != "admin":
            member.role = "admin"
            changed = True
        if changed:
            db.commit()
            logger.info("service admin: %s обновлён по .env", email)
