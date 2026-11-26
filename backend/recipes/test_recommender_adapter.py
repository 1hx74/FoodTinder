"""Юнит-тесты адаптера /next: excluded_recipe_ids и цикл по самым давним."""

from __future__ import annotations

import unittest

from recommender_adapter import (
    build_user_state,
    items_from_recipes,
    least_recent_recipe_id,
    recommend_recipe_id,
)
from recommender_system.recommender import RecipeItem


def _items(*ids: int) -> list[RecipeItem]:
    return [
        RecipeItem(
            recipe_id=recipe_id,
            title=str(recipe_id),
            tags=["soup"],
            forbidden=[],
            religions=[],
        )
        for recipe_id in ids
    ]


class FakeRecipe:
    def __init__(self, recipe_id: int, tags: list[str] | None = None) -> None:
        self.id = recipe_id
        self.title = str(recipe_id)
        self.tags = tags or ["soup"]
        self.forbidden = []
        self.religions = []


class AdapterExclusionTests(unittest.TestCase):
    def test_prefers_non_excluded_candidates(self) -> None:
        items = _items(1, 2, 3, 4)
        user = build_user_state(seen_history=[1, 2, 3], known_items=items)
        for _ in range(40):
            picked = recommend_recipe_id(
                items, user, excluded_recipe_ids=[1, 2, 3]
            )
            self.assertEqual(picked, 4)

    def test_cycles_to_least_recent_when_all_excluded(self) -> None:
        items = _items(1, 2, 3)
        # последнее вхождение: 1 позже всех, 2 раньше всех из оставшихся
        history = [1, 2, 3, 1]
        user = build_user_state(seen_history=history, known_items=items)
        picked = recommend_recipe_id(items, user, excluded_recipe_ids=history)
        self.assertEqual(picked, 2)

    def test_least_recent_helper_uses_last_occurrence(self) -> None:
        items = _items(10, 20, 30)
        self.assertEqual(least_recent_recipe_id(items, [10, 20, 30]), 10)
        self.assertEqual(least_recent_recipe_id(items, [30, 10, 20]), 30)
        self.assertEqual(least_recent_recipe_id(items, [10, 20, 30, 10]), 20)

    def test_empty_candidates_returns_none(self) -> None:
        user = build_user_state()
        self.assertIsNone(recommend_recipe_id([], user, excluded_recipe_ids=[1]))

    def test_items_from_recipes_and_history_order(self) -> None:
        recipes = [FakeRecipe(5), FakeRecipe(7), FakeRecipe(9)]
        items = items_from_recipes(recipes)
        self.assertEqual([item.recipe_id for item in items], [5, 7, 9])
        user = build_user_state(seen_history=[5, 7], known_items=items)
        self.assertEqual(user.seen_history, [5, 7])
        for _ in range(20):
            picked = recommend_recipe_id(
                items, user, excluded_recipe_ids=[5, 7]
            )
            self.assertEqual(picked, 9)


if __name__ == "__main__":
    unittest.main()
