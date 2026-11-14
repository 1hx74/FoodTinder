"""Рецепты-заглушки для теста. Вставляются только если таблица recipes пуста."""
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import IngredientQuantity, Recipe, RecipeEquipment, RecipeIngredient

_IMG = "https://placehold.co/600x400?text="
_HTML = "https://example.com/recipes/{n}.html"

G = IngredientQuantity.GRAMM.value
ML = IngredientQuantity.MILLILITER.value
IT = IngredientQuantity.ITEM.value

# title, description, cooking_time (мин), difficulty (1..5), stars (0..5),
# kalories, belki, fats, uglevods, final_weight (г),
# ingredients [(name, quantity, count)], equipment [name]
_DEMO = [
    (
        "Борщ", "Классический борщ со сметаной", 90, 3, 5,
        180, 9, 8, 18, 400,
        [("Свёкла", IT, 2), ("Говядина", G, 300), ("Капуста", G, 200),
         ("Картофель", IT, 3), ("Сметана", G, 40)],
        ["Кастрюля 4 л", "Разделочная доска", "Тёрка"],
    ),
    (
        "Омлет с сыром", "Быстрый завтрак за 10 минут", 10, 1, 4,
        250, 16, 19, 3, 180,
        [("Яйца", IT, 3), ("Молоко", ML, 50), ("Сыр", G, 40)],
        ["Сковорода", "Миска", "Венчик"],
    ),
    (
        "Паста карбонара", "Спагетти, бекон, яйцо и пармезан", 25, 2, 5,
        520, 22, 24, 55, 350,
        [("Спагетти", G, 200), ("Бекон", G, 100), ("Яичные желтки", IT, 3),
         ("Пармезан", G, 50)],
        ["Кастрюля", "Сковорода", "Дуршлаг"],
    ),
    (
        "Картошка в духовке", "Запечённый картофель с чесноком", 50, 1, 3,
        150, 3, 5, 24, 300,
        [("Картофель", IT, 6), ("Чеснок", IT, 3), ("Растительное масло", ML, 30)],
        ["Духовка", "Противень", "Разделочная доска"],
    ),
    (
        "Плов с курицей", "Рассыпчатый рис с курицей и морковью", 70, 3, 4,
        420, 24, 14, 50, 400,
        [("Рис", G, 300), ("Куриное бедро", G, 500), ("Морковь", IT, 2),
         ("Лук", IT, 2)],
        ["Казан", "Шумовка"],
    ),
    (
        "Греческий салат", "Овощи, оливки и фета", 15, 1, 4,
        190, 6, 15, 8, 250,
        [("Помидоры", IT, 3), ("Огурец", IT, 2), ("Фета", G, 100),
         ("Оливки", G, 50), ("Оливковое масло", ML, 30)],
        ["Большая миска", "Нож"],
    ),
    (
        "Блины", "Тонкие блины на молоке", 40, 2, 5,
        230, 7, 9, 30, 200,
        [("Мука", G, 200), ("Молоко", ML, 500), ("Яйца", IT, 2),
         ("Сахар", G, 20)],
        ["Блинная сковорода", "Блендер", "Лопатка"],
    ),
    (
        "Лосось на гриле", "Стейк лосося с лимоном", 30, 2, 4,
        350, 30, 24, 1, 220,
        [("Стейк лосося", IT, 2), ("Лимон", IT, 1), ("Оливковое масло", ML, 20)],
        ["Гриль-сковорода", "Щипцы"],
    ),
]


async def seed_demo_recipes(session: AsyncSession) -> int:
    count = (await session.execute(select(func.count()).select_from(Recipe))).scalar_one()
    if count:
        return 0

    for n, (
        title, desc, minutes, difficulty, stars,
        kalories, belki, fats, uglevods, final_weight,
        ingredients, equipment,
    ) in enumerate(_DEMO, start=1):
        session.add(
            Recipe(
                title=title,
                description=desc,
                image_url=_IMG + title.replace(" ", "+"),
                stars=stars,
                hypertext_url=_HTML.format(n=n),
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
                equipment=[RecipeEquipment(name=name) for name in equipment],
            )
        )

    await session.commit()
    return len(_DEMO)