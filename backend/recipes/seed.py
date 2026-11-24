"""Рецепты-заглушки для теста (16 шт.: основные блюда, супы, салаты, выпечка,
сладости, напитки, азиатская кухня — чтобы было на чём проверять рекомендации).
Вставляются только если таблица recipes пуста.

Фото и гипертекст (пошаговая инструкция с картинками) при этом скачиваются
и кладутся в наше хранилище — см. media_seed.py и seed_content.py.

Оборудование демо-рецептов — только коды из vocab.EQUIPMENT_CODES (английские,
с опечатками фронта). Список в _DEMO и equipment_codes — одно и то же;
при старте backfill_demo_meta синхронизирует уже существующие демо-рецепты
(по title) без отдельной миграции."""
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from media_seed import build_media
from models import IngredientQuantity, Recipe, RecipeEquipment, RecipeIngredient
from seed_content import RECIPE_MEDIA

# запасные ссылки — если для рецепта нет данных в seed_content.py
_IMG = "https://placehold.co/600x400?text="
_HTML = "https://example.com/recipes/{n}.html"

G = IngredientQuantity.GRAMM.value
ML = IngredientQuantity.MILLILITER.value
IT = IngredientQuantity.ITEM.value

# title, description, cooking_time (мин), difficulty (1..5), stars (0..5),
# kalories, belki, fats, uglevods, final_weight (г),
# ingredients [(name, quantity, count)], equipment [code]
# name — продукт на русском в именительном падеже, ед. числе ("Помидор", "Молоко"),
# quantity — только gramm / milliliter / item, чтобы фронт мог вывести
# "3 x шт. помидор", "300 x мл. молоко"
# equipment — коды vocab.EQUIPMENT_CODES (те же, что в equipment_codes);
# посуда/ножи/миски не указываются — они есть у всех.
_DEMO = [
    (
        "Борщ", "Классический борщ со сметаной", 90, 3, 5,
        180, 9, 8, 18, 400,
        [("Свёкла", IT, 2), ("Говядина", G, 300), ("Капуста", G, 200),
         ("Картофель", IT, 3), ("Сметана", G, 40)],
        ["stove", "grater"],  # кастрюля, тёрка
    ),
    (
        "Омлет с сыром", "Быстрый завтрак за 10 минут", 10, 1, 4,
        250, 16, 19, 3, 180,
        [("Яйцо", IT, 3), ("Молоко", ML, 50), ("Сыр", G, 40)],
        ["stove", "wisk"],  # сковорода, венчик
    ),
    (
        "Паста карбонара", "Спагетти, бекон, яйцо и пармезан", 25, 2, 5,
        520, 22, 24, 55, 350,
        [("Спагетти", G, 200), ("Бекон", G, 100), ("Яичный желток", IT, 3),
         ("Пармезан", G, 50)],
        ["stove"],  # кастрюля / сковорода
    ),
    (
        "Картошка в духовке", "Запечённый картофель с чесноком", 50, 1, 3,
        150, 3, 5, 24, 300,
        [("Картофель", IT, 6), ("Чеснок", G, 15), ("Растительное масло", ML, 30)],
        ["oven", "backind_sheet", "stove"],  # духовка, противень; картофель сначала отваривают
    ),
    (
        "Плов с курицей", "Рассыпчатый рис с курицей и морковью", 70, 3, 4,
        420, 24, 14, 50, 400,
        [("Рис", G, 300), ("Куриное бедро", G, 500), ("Морковь", IT, 2),
         ("Лук", IT, 2)],
        ["stove"],  # казан
    ),
    (
        "Греческий салат", "Овощи, оливки и фета", 15, 1, 4,
        190, 6, 15, 8, 250,
        [("Помидор", IT, 3), ("Огурец", IT, 2), ("Фета", G, 100),
         ("Оливка", G, 50), ("Оливковое масло", ML, 30)],
        [],  # миска и нож не из списка оборудования
    ),
    (
        "Блины", "Тонкие блины на молоке", 40, 2, 5,
        230, 7, 9, 30, 200,
        [("Мука", G, 200), ("Молоко", ML, 500), ("Яйцо", IT, 2),
         ("Сахар", G, 20)],
        ["stove", "blender"],  # блинная сковорода, блендер
    ),
    (
        "Лосось на гриле", "Стейк лосося с лимоном", 30, 2, 4,
        350, 30, 24, 1, 220,
        [("Лосось", G, 400), ("Лимон", IT, 1), ("Оливковое масло", ML, 20)],
        ["stove"],  # гриль-сковорода
    ),
    # ---------- сладости ----------
    (
        "Эклеры", "Заварные пирожные с ванильным кремом и шоколадной глазурью", 120, 4, 5,
        380, 6, 22, 40, 300,
        [("Мука", G, 150), ("Сливочное масло", G, 120), ("Яйцо", IT, 4),
         ("Молоко", ML, 500), ("Сахар", G, 120), ("Тёмный шоколад", G, 80)],
        ["oven", "backind_sheet", "stove", "mixer"],  # духовка, противень, сотейник, миксер
    ),
    (
        "Чизкейк Нью-Йорк", "Нежный сливочный чизкейк на песочной основе", 360, 3, 5,
        410, 8, 28, 32, 1000,
        [("Сливочный сыр", G, 600), ("Печенье", G, 200), ("Сливочное масло", G, 100),
         ("Сахар", G, 150), ("Яйцо", IT, 3), ("Сливки 33%", ML, 200)],
        ["oven", "backing_dish", "mixer", "blender"],  # духовка, разъёмная форма, миксер, блендер
    ),
    (
        "Тирамису", "Итальянский десерт с маскарпоне и кофе", 30, 2, 4,
        360, 7, 24, 30, 600,
        [("Маскарпоне", G, 500), ("Печенье савоярди", G, 200), ("Эспрессо", ML, 200),
         ("Яйцо", IT, 4), ("Сахар", G, 100), ("Какао-порошок", G, 15)],
        ["mixer", "backing_dish"],  # миксер, прямоугольная форма
    ),
    # ---------- напитки ----------
    (
        "Домашний лимонад", "Освежающий лимонад с мятой и лаймом", 10, 1, 4,
        45, 1, 1, 11, 1000,
        [("Лимон", IT, 3), ("Лайм", IT, 1), ("Мята", G, 10), ("Сахар", G, 60),
         ("Газированная вода", ML, 1000), ("Лёд", G, 200)],
        ["stove"],  # сахарный сироп
    ),
    (
        "Банановый смузи", "Густой смузи из банана, ягод и йогурта", 5, 1, 4,
        90, 3, 1, 18, 400,
        [("Банан", IT, 1), ("Ягодная смесь", G, 100), ("Йогурт", ML, 150),
         ("Мёд", G, 15)],
        ["blender"],
    ),
    (
        "Горячий шоколад", "Густой какао-напиток со сливками и маршмеллоу", 10, 1, 5,
        160, 4, 8, 18, 300,
        [("Молоко", ML, 250), ("Тёмный шоколад", G, 40), ("Сливки 33%", ML, 50),
         ("Маршмеллоу", G, 20)],
        ["stove", "wisk"],  # сотейник, венчик
    ),
    # ---------- азиатская кухня ----------
    (
        "Том ям", "Острый тайский суп с креветками и кокосовым молоком", 35, 3, 5,
        120, 9, 7, 5, 450,
        [("Креветка", G, 250), ("Кокосовое молоко", ML, 400), ("Паста том ям", G, 30),
         ("Шампиньон", G, 150), ("Лайм", IT, 1), ("Лемонграсс", IT, 2)],
        ["stove"],  # кастрюля
    ),
    (
        "Курица терияки", "Курица в сладком соусе терияки с рисом", 30, 2, 4,
        280, 20, 8, 30, 350,
        [("Куриное филе", G, 400), ("Соус терияки", ML, 80), ("Рис", G, 200),
         ("Кунжут", G, 10), ("Зелёный лук", G, 20)],
        ["stove"],  # вок / кастрюля
    ),
]


# Теги и ограничения демо-рецептов (коды и их смысл — в vocab.py).
# title -> (tags, forbidden — какие аллергены содержит,
#           religions — какие религиозные/пищевые ограничения нарушает,
#           в т.ч. vegan / vegetarian)
_META: dict[str, tuple[list[str], list[str], list[str]]] = {
    "Борщ": (
        ["soup", "russian", "meat", "vegetables", "comfort"],
        ["lactose"],  # говядина, сметана
        ["lenten", "vegetarian", "vegan"],
    ),
    "Омлет с сыром": (
        ["breakfast", "eggs", "dairy", "quick", "easy"],
        ["eggs", "lactose"],
        ["lenten", "vegan"],
    ),
    "Паста карбонара": (
        ["main", "pasta", "italian", "meat", "eggs", "quick"],
        ["wheat", "eggs", "lactose"],
        ["halal", "lenten", "vegetarian", "vegan"],  # бекон — свинина
    ),
    "Картошка в духовке": (
        ["side", "vegetables", "easy", "comfort"],
        [],
        [],
    ),
    "Плов с курицей": (
        ["main", "chicken", "rice", "asian"],
        [],
        ["lenten", "vegetarian", "vegan"],
    ),
    "Греческий салат": (
        ["salad", "vegetables", "mediterranean", "healthy", "quick"],
        ["lactose"],  # фета
        ["lenten", "vegan"],
    ),
    "Блины": (
        ["breakfast", "baking", "russian", "sweet", "dairy"],
        ["wheat", "lactose", "eggs"],
        ["lenten", "vegan"],
    ),
    "Лосось на гриле": (
        ["main", "fish", "healthy", "quick", "mediterranean"],
        ["fish", "citruses"],  # лимон
        ["lenten", "vegetarian", "vegan"],
    ),
    "Эклеры": (
        ["dessert", "baking", "french", "sweet", "chocolate"],
        ["wheat", "lactose", "eggs"],
        ["lenten", "vegan"],
    ),
    "Чизкейк Нью-Йорк": (
        ["dessert", "baking", "american", "sweet", "dairy"],
        ["wheat", "lactose", "eggs"],  # печенье — мука
        ["lenten", "vegan"],
    ),
    "Тирамису": (
        ["dessert", "italian", "sweet", "dairy"],
        ["wheat", "lactose", "eggs"],  # савоярди — мука и яйца
        ["lenten", "vegan"],
    ),
    "Домашний лимонад": (
        ["drink", "fruit", "refreshing", "sweet", "quick"],
        ["citruses"],
        [],
    ),
    "Банановый смузи": (
        ["drink", "fruit", "breakfast", "healthy", "quick"],
        ["lactose"],  # йогурт, мёд
        ["lenten", "vegan"],
    ),
    "Горячий шоколад": (
        ["drink", "chocolate", "sweet", "dairy", "comfort", "quick"],
        ["lactose"],  # маршмеллоу — желатин
        ["halal", "lenten", "vegetarian", "vegan"],  # желатин обычно свиной
    ),
    "Том ям": (
        ["soup", "asian", "seafood", "spicy"],
        ["seafood", "citruses"],  # креветки, лайм
        ["lenten", "vegetarian", "vegan"],
    ),
    "Курица терияки": (
        ["main", "chicken", "rice", "asian", "quick"],
        ["wheat"],  # соус терияки: соевый соус (пшеница)
        ["halal", "lenten", "vegetarian", "vegan"],  # в терияки мирин/саке — алкоголь
    ),
}


# Коды оборудования демо-рецептов = списки equipment в _DEMO
# (единственный источник; посуда/ножи/миски не учитываются — они есть у всех).
_EQUIPMENT: dict[str, list[str]] = {row[0]: list(row[-1]) for row in _DEMO}


async def seed_demo_recipes(session: AsyncSession) -> int:
    count = (await session.execute(select(func.count()).select_from(Recipe))).scalar_one()
    if count:
        return 0

    # title -> (image_url, hypertext_url); качается до вставки, ошибки не роняют старт
    media = await build_media([row[0] for row in _DEMO])

    for n, (
        title, desc, minutes, difficulty, stars,
        kalories, belki, fats, uglevods, final_weight,
        ingredients, equipment,
    ) in enumerate(_DEMO, start=1):
        image_url, hypertext_url = media.get(title, (None, None))
        if not hypertext_url:
            # гипертекст не сохранился — ссылка на страницу рецепта-источника
            hypertext_url = RECIPE_MEDIA.get(title, {}).get("source") or _HTML.format(n=n)
        tags, forbidden, religions = _META.get(title, ([], [], []))
        equipment_codes = _EQUIPMENT.get(title, list(equipment))
        session.add(
            Recipe(
                title=title,
                tags=tags,
                forbidden=forbidden,
                religions=religions,
                equipment_codes=equipment_codes,
                description=desc,
                image_url=image_url or _IMG + title.replace(" ", "+"),
                stars=stars,
                hypertext_url=hypertext_url,
                cooking_time=minutes,
                difficulty=difficulty,
                kalories=kalories,
                belki=belki,
                fats=fats,
                uglevods=uglevods,
                final_weight=final_weight,
                ingredients=[
                    RecipeIngredient(name=name, quantity=qty, count=cnt)
                    for name, qty, cnt in ingredients
                ],
                equipment=[RecipeEquipment(name=name) for name in equipment_codes],
            )
        )
        # flush по одному, чтобы id в БД шли в том же порядке, что и в _DEMO
        await session.flush()

    await session.commit()
    return len(_DEMO)


async def backfill_demo_meta(session: AsyncSession) -> int:
    """Для БД, засеянной до появления тегов: демо-рецептам (по title) без тегов
    проставляем tags / forbidden / religions из _META. Рецепты, у которых теги
    уже есть (в т.ч. отредактированные админом), не трогаем.

    Оборудование демо-рецептов (по title) каждый раз синхронизируем с _EQUIPMENT:
    и recipes.equipment_codes, и строки recipe_equipment (их отдаёт фронту
    поле equipment). Чужие рецепты не трогаем; если списки уже совпадают —
    ничего не пишем."""
    updated = 0
    for title, (tags, forbidden, religions) in _META.items():
        result = await session.execute(
            update(Recipe)
            .where(Recipe.title == title, func.cardinality(Recipe.tags) == 0)
            .values(tags=tags, forbidden=forbidden, religions=religions)
        )
        updated += result.rowcount or 0
    for title, codes in _EQUIPMENT.items():
        codes = list(codes)
        result = await session.execute(
            select(Recipe.id, Recipe.equipment_codes).where(Recipe.title == title)
        )
        row = result.first()
        if row is None:
            continue
        recipe_id, current_codes = row
        if list(current_codes or []) != codes:
            await session.execute(
                update(Recipe)
                .where(Recipe.id == recipe_id)
                .values(equipment_codes=codes)
            )
        names = (
            await session.execute(
                select(RecipeEquipment.name)
                .where(RecipeEquipment.recipe_id == recipe_id)
                .order_by(RecipeEquipment.id)
            )
        ).scalars().all()
        if list(names) != codes:
            await session.execute(
                delete(RecipeEquipment).where(RecipeEquipment.recipe_id == recipe_id)
            )
            session.add_all(
                [RecipeEquipment(recipe_id=recipe_id, name=name) for name in codes]
            )
    await session.commit()
    return updated
