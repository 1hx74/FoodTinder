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
    # диеты vegan / vegetarian переехали из forbidden (аллергии) в religions.
    # Переносим в старых данных; повторный запуск ничего не меняет (WHERE ... &&).
    *[
        f"""
        UPDATE {table}
        SET religions = religions || ARRAY(
                SELECT x FROM unnest(forbidden) AS x
                WHERE x IN ('vegan', 'vegetarian') AND NOT (x = ANY(religions))
            )::VARCHAR(32)[],
            forbidden = array_remove(array_remove(forbidden, 'vegan'), 'vegetarian')
        WHERE forbidden && ARRAY['vegan', 'vegetarian']::VARCHAR(32)[]
        """
        for table in ("recipes", "user_preferences")
    ],
]


async def upgrade_schema(conn: AsyncConnection) -> None:
    for stmt in _STATEMENTS:
        await conn.execute(text(stmt))
