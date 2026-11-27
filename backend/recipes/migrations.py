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
    # у рецептов диеты vegan / vegetarian лежат в religions, а не в forbidden.
    # Переносим в старых данных; повторный запуск ничего не меняет (WHERE ... &&).
    """
    UPDATE recipes
    SET religions = religions || ARRAY(
            SELECT x FROM unnest(forbidden) AS x
            WHERE x IN ('vegan', 'vegetarian') AND NOT (x = ANY(religions))
        )::VARCHAR(32)[],
        forbidden = array_remove(array_remove(forbidden, 'vegan'), 'vegetarian')
    WHERE forbidden && ARRAY['vegan', 'vegetarian']::VARCHAR(32)[]
    """,
    # --- фильтры пользователя: forbidden -> allergies, диеты — отдельным полем diets.
    # Старая схема (до этого изменения): forbidden, religions (с vegan/vegetarian), kitchen_equipment.
    # 1) forbidden -> allergies (если allergies уже есть — сливаем и удаляем forbidden)
    """
    DO $$
    BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = current_schema()
                     AND table_name = 'user_preferences' AND column_name = 'forbidden') THEN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema = current_schema()
                             AND table_name = 'user_preferences' AND column_name = 'allergies') THEN
                ALTER TABLE user_preferences RENAME COLUMN forbidden TO allergies;
            ELSE
                UPDATE user_preferences
                SET allergies = allergies || ARRAY(
                    SELECT x FROM unnest(forbidden) AS x WHERE NOT (x = ANY(allergies))
                )::VARCHAR(32)[];
                ALTER TABLE user_preferences DROP COLUMN forbidden;
            END IF;
        END IF;
    END $$
    """,
    "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS allergies VARCHAR(32)[] NOT NULL DEFAULT '{}'",
    "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS diets VARCHAR(32)[] NOT NULL DEFAULT '{}'",
    # 2) vegan / vegetarian из religions и allergies -> diets (без дублей)
    """
    UPDATE user_preferences
    SET diets = diets || ARRAY(
            SELECT DISTINCT x FROM unnest(religions || allergies) AS x
            WHERE x IN ('vegan', 'vegetarian') AND NOT (x = ANY(diets))
        )::VARCHAR(32)[],
        religions = array_remove(array_remove(religions, 'vegan'), 'vegetarian'),
        allergies = array_remove(array_remove(allergies, 'vegan'), 'vegetarian')
    WHERE (religions || allergies) && ARRAY['vegan', 'vegetarian']::VARCHAR(32)[]
    """,
    # С наших медиа-ссылок снимаем схему и хост (старые абсолютные значения).
    """
    UPDATE recipes
    SET image_url = regexp_replace(image_url, '^https?://[^/]+', '')
    WHERE image_url ~ '^https?://[^/]+/api/db/'
    """,
    """
    UPDATE recipes
    SET hypertext_url = regexp_replace(hypertext_url, '^https?://[^/]+', '')
    WHERE hypertext_url ~ '^https?://[^/]+/api/db/'
    """,
]


async def upgrade_schema(conn: AsyncConnection) -> None:
    for stmt in _STATEMENTS:
        await conn.execute(text(stmt))
