"""Лёгкие миграции схемы при старте.

Base.metadata.create_all создаёт только отсутствующие таблицы и не трогает
существующие. Чтобы БД, созданная до появления новых колонок (volume pgdata),
продолжала работать без docker compose down -v, добавляем их тут.
Все команды идемпотентны (IF NOT EXISTS).
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

_STATEMENTS = [
    # теги и ограничения рецепта (см. vocab.py)
    "ALTER TABLE recipes ADD COLUMN IF NOT EXISTS tags VARCHAR(32)[] NOT NULL DEFAULT '{}'",
    "ALTER TABLE recipes ADD COLUMN IF NOT EXISTS forbidden VARCHAR(32)[] NOT NULL DEFAULT '{}'",
    "ALTER TABLE recipes ADD COLUMN IF NOT EXISTS religions VARCHAR(32)[] NOT NULL DEFAULT '{}'",
    "ALTER TABLE recipes ADD COLUMN IF NOT EXISTS equipment_codes VARCHAR(32)[] NOT NULL DEFAULT '{}'",
]


async def upgrade_schema(conn: AsyncConnection) -> None:
    for stmt in _STATEMENTS:
        await conn.execute(text(stmt))
