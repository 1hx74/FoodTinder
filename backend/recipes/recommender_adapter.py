"""Адаптер рекомендательной системы Войтовой к выдаче /next.

Её код (recommender_system.recommender) не меняем: отсюда собираем
RecipeItem / UserState из наших рецептов, предпочтений, реакций и показов
и вызываем RecipeRecommender.next_recipe. Состояние в её объект не копим —
каждый запрос собираем заново (так работает с несколькими воркерами).
"""

from __future__ import annotations

from collections.abc import Sequence

from recommender_system.recommender import RecipeItem, RecipeRecommender, UserState

# Один движок на процесс: у него нет пользовательского состояния, только коэффициенты.
_engine = RecipeRecommender()


def items_from_recipes(recipes: Sequence[object]) -> list[RecipeItem]:
    """Рецепты из БД (или любые объекты с теми же полями) -> список RecipeItem."""
    items: list[RecipeItem] = []
    for recipe in recipes:
        items.append(
            RecipeItem(
                recipe_id=recipe.id,
                title=recipe.title,
                tags=list(recipe.tags or []),
                forbidden=list(recipe.forbidden or []),
                religions=list(recipe.religions or []),
            )
        )
    return items


def build_user_state(
    *,
    allergies: Sequence[str] = (),
    religions_and_diets: Sequence[str] = (),
    liked_ids: Sequence[int] = (),
    disliked_ids: Sequence[int] = (),
    favorite_ids: Sequence[int] = (),
    seen_history: Sequence[int] = (),
    known_items: Sequence[RecipeItem] = (),
) -> UserState:
    """UserState для её скорера: аллергии/диеты, история показов, веса тегов из реакций.

    register_reaction понимает только like/dislike, поэтому избранное идёт как like.
    Если рецепт и в избранном, и в дизлайках, побеждает дизлайк (как более жёсткая оценка).
    Лайк по одному рецепту применяем один раз, даже если он ещё и в избранном.
    """
    user = UserState(
        allergies=set(allergies),
        religions_and_diets=set(religions_and_diets),
        seen_history=list(seen_history),
    )
    by_id = {item.recipe_id: item for item in known_items}

    disliked = list(dict.fromkeys(disliked_ids))
    disliked_set = set(disliked)
    like_ids: list[int] = []
    seen: set[int] = set()
    for recipe_id in (*liked_ids, *favorite_ids):
        if recipe_id in disliked_set or recipe_id in seen:
            continue
        seen.add(recipe_id)
        like_ids.append(recipe_id)

    for recipe_id in like_ids:
        item = by_id.get(recipe_id)
        if item is not None:
            _engine.register_reaction(user, item, "like")
    for recipe_id in disliked:
        item = by_id.get(recipe_id)
        if item is not None:
            _engine.register_reaction(user, item, "dislike")
    return user


def recommend_recipe_id(
    candidates: Sequence[RecipeItem],
    user: UserState,
) -> int | None:
    """Следующий рецепт её алгоритмом. None — подходящих не осталось."""
    picked = _engine.next_recipe(list(candidates), user)
    return None if picked is None else picked.recipe_id
