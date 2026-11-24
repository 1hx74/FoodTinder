"""Словари кодов для рецептов и рекомендаций.

TAGS — теги рецепта (отдаются фронту в поле "tags"). Общие, переиспользуемые,
чтобы ими можно было разметить ~50 рецептов и строить по ним рекомендации.

Пользователь (GET/PATCH /api/db/me/preferences, см. frontend/filter):
  allergies -> ALLERGY_CODES, diets -> DIET_CODES, religions -> RELIGION_CODES,
  kitchen_equipment -> EQUIPMENT_CODES.

Рецепт хранит ограничения в двух полях (FORBIDDEN_CODES, RECIPE_RELIGION_CODES):
recipe.forbidden = аллергии, recipe.religions = религия + диеты.
Анонимный POST /next принимает те же два поля, что и рецепт (forbidden, religions).
У рецепта эти поля означают «кому рецепт НЕ подходит» (что он нарушает):
  recipe.forbidden  — аллергены, которые есть в рецепте (у пользователя — его аллергии):
      nuts      — есть орехи
      seafood   — есть морепродукты (креветки, кальмары, мидии...)
      lactose   — есть молочные продукты (молоко, сливки, сыр, масло сливочное, йогурт...)
      fish      — есть рыба
      eggs      — есть яйца (в т.ч. в составе печенья/савоярди)
      wheat     — есть пшеница/глютен (мука, паста, печенье, соевый соус)
      citruses  — есть цитрусовые (лимон, лайм, апельсин)
  recipe.religions — религиозные и пищевые ограничения (исключают целые группы
  продуктов), которые рецепт нарушает:
      halal     — свинина (бекон), алкоголь (в т.ч. мирин в терияки), желатин
      lenten    — строгий православный пост: мясо, птица, рыба, морепродукты,
                  молочное, яйца
      vegetarian — есть мясо, птица, рыба, морепродукты или желатин
      vegan     — есть любой продукт животного происхождения
                  (всё из vegetarian + молочное, яйца, мёд)

EQUIPMENT_CODES — коды кухонного оборудования, те же, что у пользователя
в "kitchen_equipment" (frontend/filter, data-type="equipment"). Опечатки
(backing_dish, backind_sheet, wisk, rolling_scale) — как во фронте, не исправлять.
recipe.equipment_codes — что из этого НУЖНО для рецепта (пусто — ничего особого).

Рекомендации: рецепт не показывается, если его forbidden пересекается
с forbidden пользователя или его religions — с religions пользователя.
equipment_codes пока только хранится (по оборудованию фильтрует фронт).
"""

TAGS: tuple[str, ...] = (
    # тип блюда
    "breakfast", "soup", "salad", "main", "side", "dessert", "baking", "drink",
    # основной ингредиент
    "meat", "chicken", "fish", "seafood", "pasta", "rice", "eggs", "dairy",
    "vegetables", "fruit", "chocolate",
    # кухня
    "russian", "italian", "asian", "mediterranean", "american", "french",
    # характер
    "quick",       # готовится до 30 минут
    "easy", "spicy", "sweet", "healthy", "refreshing", "comfort",
)

# аллергии
ALLERGY_CODES: tuple[str, ...] = (
    "nuts", "seafood", "lactose", "fish", "eggs", "wheat", "citruses",
)

# диеты
DIET_CODES: tuple[str, ...] = ("vegan", "vegetarian")

# религия
RELIGION_CODES: tuple[str, ...] = ("halal", "lenten")

# поля рецепта (и анонимного POST /next):
#   recipe.forbidden — аллергии, recipe.religions — религия + диеты
FORBIDDEN_CODES: tuple[str, ...] = ALLERGY_CODES
RECIPE_RELIGION_CODES: tuple[str, ...] = RELIGION_CODES + DIET_CODES

EQUIPMENT_CODES: tuple[str, ...] = (
    "oven",           # духовка
    "stove",          # плита
    "microwave",      # микроволновка
    "multicooker",    # мультиварка
    "air_fryer",      # аэрогриль
    "toaster",        # тостер
    "waffle_maker",   # вафельница
    "mixer",          # миксер
    "blender",        # блендер
    "meat_grinder",   # мясорубка
    "backing_dish",   # форма для запекания (так во фронте)
    "backind_sheet",  # противень (так во фронте)
    "grater",         # тёрка
    "wisk",           # венчик (так во фронте)
    "rolling_scale",  # скалка (так во фронте)
)


def clean_codes(values: list[str], allowed: tuple[str, ...], what: str) -> list[str]:
    """Нормализует (strip/lower, без дублей) и проверяет по словарю.
    ValueError, если есть неизвестный код."""
    out = list(dict.fromkeys(v.strip().lower() for v in values))
    unknown = [v for v in out if v not in allowed]
    if unknown:
        raise ValueError(f"неизвестные {what}: {', '.join(unknown)}")
    return out
