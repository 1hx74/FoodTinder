"""Рецепты-заглушки для теста. Вставляются только если таблица recipes пуста."""
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Recipe

_IMG = "https://placehold.co/600x400?text="
_HTML = "https://example.com/recipes/{n}.html"

_DEMO = [
    ("Борщ", "Классический борщ со сметаной", 90, 3, 5),
    ("Омлет с сыром", "Быстрый завтрак за 10 минут", 10, 1, 4),
    ("Паста карбонара", "Спагетти, бекон, яйцо и пармезан", 25, 2, 5),
    ("Картошка в духовке", "Запечённый картофель с чесноком", 50, 1, 3),
    ("Плов с курицей", "Рассыпчатый рис с курицей и морковью", 70, 3, 4),
    ("Греческий салат", "Овощи, оливки и фета", 15, 1, 4),
    ("Блины", "Тонкие блины на молоке", 40, 2, 5),
    ("Лосось на гриле", "Стейк лосося с лимоном", 30, 2, 4),
]


async def seed_demo_recipes(session: AsyncSession) -> int:
    count = (await session.execute(select(func.count()).select_from(Recipe))).scalar_one()
    if count:
        return 0
    for n, (title, desc, minutes, difficulty, stars) in enumerate(_DEMO, start=1):
        session.add(
            Recipe(
                title=title,
                description=desc,
                image_url=_IMG + title.replace(" ", "+"),
                stars=stars,
                hypertext_url=_HTML.format(n=n),
                cooking_time=minutes,
                difficulty=difficulty,
            )
        )
    await session.commit()
    return len(_DEMO)
