"""Дополнительные рецепты для сида из recipes200.json (его собирает collect_recipes.py).

Файл необязательный: если его нет, сид работает как раньше (16 демо-рецептов).
Формат записи в JSON — тот же, что у демо-рецептов в seed.py (КБЖУ на 100 г,
final_weight — вес всего блюда), плюс image_url / source_url /
steps (как seed_content.RECIPE_MEDIA). Картинки при первом старте качает media_seed.py.

Как и демо-рецепты, вставляются только в ПУСТУЮ таблицу recipes
(т.е. после `docker compose down -v` или на свежей БД).

SEED_EXTRA_JSON — путь к файлу (по умолчанию recipes200.json рядом с этим модулем),
SEED_EXTRA=false — не грузить.
"""
import json
import logging
import os
from pathlib import Path

from models import IngredientQuantity
from vocab import EQUIPMENT_CODES, FORBIDDEN_CODES, RECIPE_RELIGION_CODES, TAGS, clean_codes

logger = logging.getLogger("uvicorn.error")

EXTRA_PATH = Path(os.getenv("SEED_EXTRA_JSON", str(Path(__file__).with_name("recipes200.json"))))
SEED_EXTRA = os.getenv("SEED_EXTRA", "true").lower() == "true"
_QUANTITIES = {q.value for q in IngredientQuantity}


def _row(r: dict) -> tuple:
    ingredients = []
    for i in r["ingredients"]:
        if i["quantity"] not in _QUANTITIES:
            raise ValueError(f"единица {i['quantity']!r} у «{i['name']}»")
        ingredients.append((str(i["name"])[:64], i["quantity"], float(i["count"])))
    equipment = clean_codes(r.get("equipment_codes", []), EQUIPMENT_CODES, "коды оборудования")
    return (
        str(r["title"])[:128], str(r.get("description", ""))[:512],
        max(1, int(r["cooking_time"])), min(5, max(1, int(r["difficulty"]))),
        min(5, max(0, int(r.get("stars", 4)))),
        int(r["kalories"]), int(r["belki"]), int(r["fats"]), int(r["uglevods"]),
        int(r["final_weight"]),
        ingredients, equipment,
    )


def load_extra(existing_titles: set[str]) -> tuple[list[tuple], dict, dict]:
    """-> (строки как в seed._DEMO, записи как в seed._META, записи как в RECIPE_MEDIA)."""
    if not SEED_EXTRA or not EXTRA_PATH.is_file():
        return [], {}, {}
    try:
        data = json.loads(EXTRA_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        logger.warning("seed extra: не прочитан %s: %s", EXTRA_PATH, e)
        return [], {}, {}
    rows, meta, media = [], {}, {}
    titles = set(existing_titles)
    for r in data.get("recipes", data if isinstance(data, list) else []):
        title = str(r.get("title", "")).strip()
        try:
            if not title or title in titles:
                raise ValueError("нет названия или дубль")
            row = _row(r)
            meta[title] = (
                clean_codes(r.get("tags", []), TAGS, "теги"),
                clean_codes(r.get("forbidden", []), FORBIDDEN_CODES, "аллергены"),
                clean_codes(r.get("religions", []), RECIPE_RELIGION_CODES, "ограничения"),
            )
        except (KeyError, TypeError, ValueError) as e:
            logger.warning("seed extra: пропущен «%s»: %s", title or "?", e)
            continue
        titles.add(title)
        rows.append(row)
        media[title] = {
            "source": r.get("source_url"),
            "photo": r["image_url"],
            "steps": [(s["text"], s.get("image")) for s in r.get("steps", [])],
        }
    logger.info("seed extra: %d рецептов из %s", len(rows), EXTRA_PATH.name)
    return rows, meta, media
