import random
from collections import defaultdict
from dataclasses import dataclass, field


@dataclass
class RecipeItem:
    recipe_id: int
    title: str
    tags: list[str]
    forbidden: list[str]
    religions: list[str]


@dataclass
class UserState:
    allergies: set[str] = field(default_factory=set)
    religions_and_diets: set[str] = field(default_factory=set)
    tag_weights: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    seen_history: list[int] = field(default_factory=list)
    disliked_ids: set[int] = field(default_factory=set)


class RecipeRecommender:
    """Реализация рекомендательной системы

        Реализует фильтр по основным предпочтениям/непереносимости пользователя
        Отслеживает следующий рецепт по среднему баллу тегов

        Args:
            base_tag_score: базовый балл для каждого тега у каждого 2.0
            like_step: +0.6 баллов к каждому тегу рецепта который пользователь лайкнул
            dislike_step: -0.25 тега при дизлайке рецепта
            min_tag_delta: нижний порог тега -1.5.
            max_tag_delta: верхний порог тега 4.0.
            history_window: по дефолту хранит 7 последних просмотренных рецептов
            recency_step_penalty: если рецепт был в последних 7, то чтобы понизить его рейтинг вычитаем от всего рецепта 0.55 * давность.
            exploration_rate: 0.25 вероятность что появится рецепт который по тегам не проходит, но прошло фильтрацию
        """
    def __init__(
        self,
        base_tag_score: float = 2.0,
        like_step: float = 0.6,
        dislike_step: float = -0.25,
        min_tag_delta: float = -1.5,
        max_tag_delta: float = 4.0,
        history_window: int = 7,
        recency_step_penalty: float = 0.55,
        exploration_rate: float = 0.25,
    ) -> None:
        self.base_tag_score = base_tag_score
        self.like_step = like_step
        self.dislike_step = dislike_step
        self.min_tag_delta = min_tag_delta
        self.max_tag_delta = max_tag_delta
        self.history_window = history_window
        self.recency_step_penalty = recency_step_penalty
        self.exploration_rate = exploration_rate

    def _effective_window(self, allowed_count: int) -> int:
        """
        Подбирает, сколько последних рецептов учитывать при защите от повторов,
        чтобы не заблокировать выбор, когда доступных блюд мало
        """
        if allowed_count <= 1:
            return 0
        return min(self.history_window, max(1, allowed_count // 2))

    def is_allowed(self, recipe: RecipeItem, user: UserState) -> bool:
        """
        Проверяет рецепт на соблюдение ограничений от пользователя
        """
        recipe_forbidden = {x.strip().lower() for x in recipe.forbidden}
        recipe_religions = {x.strip().lower() for x in recipe.religions}
        user_allergies = {x.strip().lower() for x in user.allergies}
        user_religions = {x.strip().lower() for x in user.religions_and_diets}

        if recipe_forbidden & user_allergies:
            return False
        if recipe_religions & user_religions:
            return False
        return True

    def score(self, recipe: RecipeItem, user: UserState, active_window: int | None = None) -> float:
        """
        Вычисляет итоговый балл рецепта для пользователя

        Учитывает средний вес тегов, прибавляет кол-во тегов * 0.15(максимально можно прибавить 0.9 т.е за 6 тегов),убавляет за недавний показ
        и персональный дизлайк блюда.
        """
        if not recipe.tags:
            return 0.0

        window = active_window if active_window is not None else self.history_window

        tag_values = [
            max(0.0, self.base_tag_score + user.tag_weights.get(tag, 0.0))
            for tag in recipe.tags
        ]
        avg_tag_score = sum(tag_values) / len(tag_values)
        length_bonus = min(len(recipe.tags), 6) * 0.15

        recency_penalty = 0.0
        if window > 0 and recipe.recipe_id in user.seen_history:
            pos_from_end = len(user.seen_history) - 1 - user.seen_history.index(recipe.recipe_id)
            recency_penalty = max(0.0, (window - pos_from_end) * self.recency_step_penalty)

        dislike_penalty = 2.5 if recipe.recipe_id in user.disliked_ids else 0.0

        return avg_tag_score + length_bonus - recency_penalty - dislike_penalty

    def _pick_novel(self, candidates: list[RecipeItem], user: UserState) -> RecipeItem:
        """
        Метод для выбора случайного рецепта из подходящего по категориям
        Выбирает рецепт с наименее знакомыми тегами для разнообразия
        """
        def novelty_score(item: RecipeItem) -> float:
            if not item.tags:
                return 0.0
            familiarity = sum(abs(user.tag_weights.get(t, 0.0)) for t in item.tags) / len(item.tags)
            return familiarity + random.uniform(0.0, 0.4)

        ranked = sorted(candidates, key=novelty_score)
        top_novel = ranked[: max(1, min(3, len(ranked)))]
        return random.choice(top_novel)

    def next_recipe(self, recipes: list[RecipeItem], user: UserState) -> RecipeItem | None:
        """
        Метод подбора следующего рецепта
        """
        allowed = [r for r in recipes if self.is_allowed(r, user)]
        if not allowed:
            return None

        window = self._effective_window(len(allowed))
        recent = set(user.seen_history[-window:]) if window > 0 else set()
        fresh = [r for r in allowed if r.recipe_id not in recent]

        if len(fresh) >= 2:
            pool = fresh
        else:
            last_id = user.seen_history[-1] if user.seen_history else None
            pool = [r for r in allowed if r.recipe_id != last_id] or allowed

        if len(pool) > 1 and random.random() < self.exploration_rate:
            picked = self._pick_novel(pool, user)
        else:
            ranked = sorted(pool, key=lambda r: self.score(r, user, active_window=window), reverse=True)
            top_k = ranked[: min(3, len(ranked))]
            picked = random.choice(top_k)

        user.seen_history.append(picked.recipe_id)
        return picked

    def register_reaction(self, user: UserState, recipe: RecipeItem, action: str) -> None:
        """
        Обновляет веса тегов пользователя при получении реакции лайк/дизлайк
        """
        if action == "like":
            user.disliked_ids.discard(recipe.recipe_id)
            for tag in recipe.tags:
                updated = user.tag_weights[tag] + self.like_step
                user.tag_weights[tag] = min(self.max_tag_delta, updated)
        elif action == "dislike":
            user.disliked_ids.add(recipe.recipe_id)
            for tag in recipe.tags:
                updated = user.tag_weights[tag] + self.dislike_step
                user.tag_weights[tag] = max(self.min_tag_delta, updated)


if __name__ == "__main__":
    demo_recipes = [
        RecipeItem(1, "Борщ", ["soup", "meat", "vegetables"], ["lactose"], ["vegetarian", "vegan"]),
        RecipeItem(2, "Паста карбонара", ["main", "pasta", "italian", "meat", "eggs", "quick"], ["eggs", "lactose"], ["halal","vegetarian", "vegan"]),
        RecipeItem(3, "Плов с курицей", ["main", "chicken", "rice", "asian"], [], ["lenten", "vegetarian", "vegan"]),
        RecipeItem(4, "Греческий салат", ["salad", "vegetables", "mediterranean", "healthy", "quick"], ["lactose"], ["vegan"]),
        RecipeItem(5, "Блины", ["breakfast", "baking", "russian", "sweet", "dairy"], ["wheat", "lactose", "eggs"], ["vegan"]),
        RecipeItem(6, "Лосось", ["main", "fish", "healthy", "quick", "mediterranean"], ["fish", "citruses"], ["vegetarian", "vegan"]),
        RecipeItem(7, "Домашний лимонад", ["drink", "fruit", "refreshing", "sweet", "quick"], ["citruses"], []),
        RecipeItem(8, "Том ям", ["soup", "asian", "seafood", "spicy"], ["seafood", "citruses"], ["vegetarian", "vegan"]),
        RecipeItem(9, "Курица терияки", ["main", "chicken", "rice", "asian", "quick"], [ ], ["halal", "vegetarian", "vegan"]),
    ]

    engine = RecipeRecommender()
    user = UserState(allergies={"lactose"}, religions_and_diets=set())
    engine.register_reaction(user, demo_recipes[2], "like")
    engine.register_reaction(user, demo_recipes[8], "like")

    for step in range(1, 9):
        nxt = engine.next_recipe(demo_recipes, user)
        assert nxt is not None
        assert "lactose" not in nxt.forbidden
        print(f"{step:2d}. {nxt.title:20s} -> {nxt.tags}")