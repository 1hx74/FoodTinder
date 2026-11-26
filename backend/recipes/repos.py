from collections.abc import Sequence

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import (
    IngredientQuantity,
    ReactionAction,
    Recipe,
    RecipeEquipment,
    RecipeImpression,
    RecipeIngredient,
    RecipeReaction,
)


def _ingredient_rows(recipe_id: int | None, items: Sequence[dict]) -> list[RecipeIngredient]:
    return [
        RecipeIngredient(
            recipe_id=recipe_id,
            name=i["name"],
            quantity=IngredientQuantity(i["quantity"]).value,
            count=i["count"],
        )
        for i in items
    ]


def _equipment_rows(recipe_id: int | None, names: Sequence[str]) -> list[RecipeEquipment]:
    return [RecipeEquipment(recipe_id=recipe_id, name=n) for n in names]


class RecipeRepository:
    """Все операции с БД, нужные эндпоинтам. Рассчитано на PostgreSQL."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, recipe_id: int) -> Recipe | None:
        """Рецепт сразу с ингредиентами и оборудованием."""
        stmt = (
            select(Recipe)
            .where(Recipe.id == recipe_id)
            .options(
                selectinload(Recipe.ingredients),
                selectinload(Recipe.equipment),
            )
            # свежие данные, даже если объект уже лежит в identity map сессии
            .execution_options(populate_existing=True)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_feed_recipes(
        self,
        forbidden: Sequence[str] = (),
        religions: Sequence[str] = (),
    ) -> list[Recipe]:
        """Рецепты после жёстких фильтров по аллергиям и религии/диетам.
        Показанные и оценённые не отсекаем — лента циклическая."""
        stmt = select(Recipe)
        if forbidden:
            stmt = stmt.where(~Recipe.forbidden.overlap(list(forbidden)))
        if religions:
            stmt = stmt.where(~Recipe.religions.overlap(list(religions)))
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_recipes_by_ids(self, ids: Sequence[int]) -> list[Recipe]:
        ids = list(dict.fromkeys(ids))
        if not ids:
            return []
        stmt = select(Recipe).where(Recipe.id.in_(ids))
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_user_reactions(self, user_id: str) -> list[tuple[int, str]]:
        stmt = select(RecipeReaction.recipe_id, RecipeReaction.action).where(
            RecipeReaction.user_id == user_id
        )
        rows = (await self.session.execute(stmt)).all()
        result: list[tuple[int, str]] = []
        for recipe_id, action in rows:
            value = action.value if isinstance(action, ReactionAction) else str(action)
            result.append((recipe_id, value))
        return result

    async def list_impressions(self, user_id: str) -> list[int]:
        """id в порядке показа (старые сначала): так recency у рекомендателя
        смотрит на конец списка как на недавние."""
        stmt = (
            select(RecipeImpression.recipe_id)
            .where(RecipeImpression.user_id == user_id)
            .order_by(RecipeImpression.created_at.asc(), RecipeImpression.id.asc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_next(
        self,
        user_id: str | None,
        exclude: Sequence[int] = (),
        forbidden: Sequence[str] = (),
        religions: Sequence[str] = (),
        liked: Sequence[int] = (),
        disliked: Sequence[int] = (),
        excluded_recipe_ids: Sequence[int] = (),
    ) -> Recipe | None:
        """
        Следующий рецепт через рекомендатель Войтовой.
        user_id задан -> реакции и история показов из БД.
        user_id=None  -> liked/disliked и excluded_recipe_ids из тела
        анонимного POST/PATCH /next.
        exclude — id, которые клиент уже держит в очереди (сейчас не отдаём).
        excluded_recipe_ids — уже показанные гостю: идут в историю recency
        (порядок как прислали, свежие в конце). Пока есть другие кандидаты,
        показанные не возвращаем; если остались только они — самый давний.
        forbidden / religions — жёсткий фильтр (оператор &&), как раньше.
        Показанные и оценённые больше не выкидываются насовсем: лента циклическая.
        """
        from recommender_adapter import (
            build_user_state,
            items_from_recipes,
            recommend_recipe_id,
        )

        feed = await self.list_feed_recipes(forbidden=forbidden, religions=religions)
        exclude_set = set(exclude)
        candidates = [r for r in feed if r.id not in exclude_set]
        if not candidates:
            return None

        if user_id is not None:
            reactions = await self.list_user_reactions(user_id)
            liked_ids = [rid for rid, action in reactions if action == "like"]
            disliked_ids = [rid for rid, action in reactions if action == "dislike"]
            favorite_ids = [rid for rid, action in reactions if action == "favorite"]
            seen_history = await self.list_impressions(user_id)
        else:
            liked_ids = list(liked)
            disliked_ids = list(disliked)
            favorite_ids = []
            # порядок как прислал клиент: старые первые, свежие в конце
            seen_history = list(excluded_recipe_ids)

        # очередь клиента — в конце истории, чтобы рекомендатель считал их недавними
        seen_history = list(seen_history)
        seen_history.extend(exclude)

        known = {r.id: r for r in feed}
        missing = [
            rid
            for rid in (*liked_ids, *disliked_ids, *favorite_ids)
            if rid not in known
        ]
        if missing:
            for recipe in await self.get_recipes_by_ids(missing):
                known[recipe.id] = recipe

        items = items_from_recipes(candidates)
        reaction_items = items_from_recipes(known.values())
        user = build_user_state(
            allergies=forbidden,
            religions_and_diets=religions,
            liked_ids=liked_ids,
            disliked_ids=disliked_ids,
            favorite_ids=favorite_ids,
            seen_history=seen_history,
            known_items=reaction_items,
        )
        picked_id = recommend_recipe_id(
            items, user, excluded_recipe_ids=excluded_recipe_ids
        )
        if picked_id is None:
            return None
        return next((r for r in candidates if r.id == picked_id), None)

    async def mark_shown(self, user_id: str, recipe_id: int) -> None:
        # при повторном показе обновляем created_at, иначе после первого круга
        # recency рекомендателя всегда штрафует одни и те же «первые» рецепты
        stmt = (
            pg_insert(RecipeImpression)
            .values(user_id=user_id, recipe_id=recipe_id)
            .on_conflict_do_update(
                index_elements=["user_id", "recipe_id"],
                set_={"created_at": func.now()},
            )
        )
        await self.session.execute(stmt)
        await self.session.commit()

    async def set_reaction(
        self,
        user_id: str,
        recipe_id: int,
        action: ReactionAction,
    ) -> bool:
        """False, если рецепта не существует (в т.ч. удалён параллельно)."""
        if await self.session.get(Recipe, recipe_id) is None:
            return False

        opposite = {
            ReactionAction.LIKE: ReactionAction.DISLIKE,
            ReactionAction.DISLIKE: ReactionAction.LIKE,
        }.get(action)

        try:
            if opposite is not None:
                await self.session.execute(
                    delete(RecipeReaction).where(
                        RecipeReaction.user_id == user_id,
                        RecipeReaction.recipe_id == recipe_id,
                        RecipeReaction.action == opposite.value,
                    )
                )
            await self.session.execute(
                pg_insert(RecipeReaction)
                .values(user_id=user_id, recipe_id=recipe_id, action=action.value)
                .on_conflict_do_nothing(index_elements=["user_id", "recipe_id", "action"])
            )
            await self.session.commit()
        except IntegrityError:
            # рецепт удалили между проверкой и вставкой (FK)
            await self.session.rollback()
            return False

        return True

    async def set_reactions_bulk(
        self,
        user_id: str,
        recipe_ids: Sequence[int],
        action: ReactionAction,
    ) -> list[int]:
        """Массовая установка like/dislike (перенос из кэша клиента).
        Возвращает id, к которым реакция реально применена (существующие рецепты)."""
        ids = list(dict.fromkeys(recipe_ids))  # без дублей, порядок сохраняем
        if not ids:
            return []

        existing = set(
            (await self.session.execute(select(Recipe.id).where(Recipe.id.in_(ids))))
            .scalars()
            .all()
        )
        ids = [i for i in ids if i in existing]
        if not ids:
            return []

        opposite = {
            ReactionAction.LIKE: ReactionAction.DISLIKE,
            ReactionAction.DISLIKE: ReactionAction.LIKE,
        }.get(action)

        try:
            if opposite is not None:
                await self.session.execute(
                    delete(RecipeReaction).where(
                        RecipeReaction.user_id == user_id,
                        RecipeReaction.recipe_id.in_(ids),
                        RecipeReaction.action == opposite.value,
                    )
                )
            await self.session.execute(
                pg_insert(RecipeReaction)
                .values(
                    [{"user_id": user_id, "recipe_id": i, "action": action.value} for i in ids]
                )
                .on_conflict_do_nothing(index_elements=["user_id", "recipe_id", "action"])
            )
            await self.session.commit()
        except IntegrityError:
            # какой-то рецепт удалили параллельно — повторяем с актуальным списком
            await self.session.rollback()
            return await self.set_reactions_bulk(user_id, ids, action)

        return ids

    async def _recipe_ids_by_action(self, user_id: str, action: ReactionAction) -> list[int]:
        stmt = (
            select(RecipeReaction.recipe_id)
            .where(
                RecipeReaction.user_id == user_id,
                RecipeReaction.action == action,
            )
            .order_by(RecipeReaction.created_at.desc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_liked(self, user_id: str) -> list[int]:
        return await self._recipe_ids_by_action(user_id, ReactionAction.LIKE)

    async def get_disliked(self, user_id: str) -> list[int]:
        return await self._recipe_ids_by_action(user_id, ReactionAction.DISLIKE)

    async def get_favourite(self, user_id:str) -> list[int]:
         return await self._recipe_ids_by_action(user_id, ReactionAction.FAVORITE)

    async def get_favourite_brief(
        self, user_id: str
    ) -> list[tuple[int, str, list[str], list[str]]]:
        """(id, title, tags, названия ингредиентов) избранного в том же порядке,
        что get_favourite — для поиска по избранному (search.py)."""
        stmt = (
            select(Recipe.id, Recipe.title, Recipe.tags)
            .join(RecipeReaction, RecipeReaction.recipe_id == Recipe.id)
            .where(
                RecipeReaction.user_id == user_id,
                RecipeReaction.action == ReactionAction.FAVORITE,
            )
            .order_by(RecipeReaction.created_at.desc())
        )
        rows = (await self.session.execute(stmt)).all()
        ingredients: dict[int, list[str]] = {}
        if rows:
            ing_rows = await self.session.execute(
                select(RecipeIngredient.recipe_id, RecipeIngredient.name)
                .where(RecipeIngredient.recipe_id.in_([r[0] for r in rows]))
                .order_by(RecipeIngredient.id)
            )
            for rid, name in ing_rows:
                ingredients.setdefault(rid, []).append(name)
        return [
            (rid, title, list(tags or []), ingredients.get(rid, []))
            for rid, title, tags in rows
        ]

    async def remove_reaction(
        self,
        user_id: str,
        recipe_id: int,
        action: ReactionAction,
    ) -> bool | None:
        """Снять одну реакцию. None, если рецепта нет;
        True — строка удалена, False — такой реакции не было.
        Другие реакции на этот рецепт и impressions не трогаем."""
        exists = await self.session.execute(
            select(Recipe.id).where(Recipe.id == recipe_id)
        )
        if exists.scalar_one_or_none() is None:
            return None

        result = await self.session.execute(
            delete(RecipeReaction)
            .where(
                RecipeReaction.user_id == user_id,
                RecipeReaction.recipe_id == recipe_id,
                RecipeReaction.action == action,
            )
            .returning(RecipeReaction.recipe_id)
        )
        removed = result.scalar_one_or_none() is not None
        await self.session.commit()
        return removed

    async def remove_reactions(
        self,
        user_id: str,
        action: ReactionAction,
        recipe_ids: Sequence[int] | None = None,
    ) -> list[int]:
        """Удаляет реакции пользователя. recipe_ids=None — весь список.
        Возвращает id, которые реально были удалены:
        для заданных id — в том же порядке, без дублей;
        при очистке всего списка — как в GET (по убыванию created_at).
        Impression не трогаем."""
        stmt = delete(RecipeReaction).where(
            RecipeReaction.user_id == user_id,
            RecipeReaction.action == action,
        )
        if recipe_ids is not None:
            ids = list(dict.fromkeys(recipe_ids))
            if not ids:
                return []
            stmt = stmt.where(RecipeReaction.recipe_id.in_(ids))

        result = await self.session.execute(
            stmt.returning(RecipeReaction.recipe_id, RecipeReaction.created_at)
        )
        rows = result.all()
        await self.session.commit()

        if recipe_ids is not None:
            removed = {rid for rid, _ in rows}
            return [i for i in ids if i in removed]

        rows.sort(key=lambda r: r[1], reverse=True)
        return [rid for rid, _ in rows]

    # ---------- управление рецептами ----------

    async def create(self, data: dict) -> Recipe:
        """data может содержать ключи ingredients (list[dict]) и equipment (list[str])."""
        data = dict(data)
        ingredients = data.pop("ingredients", None) or []
        equipment = data.pop("equipment", None) or []

        recipe = Recipe(
            **data,
            ingredients=_ingredient_rows(None, ingredients),
            equipment=_equipment_rows(None, equipment),
        )
        self.session.add(recipe)
        await self.session.commit()

        # после commit атрибуты экспайрятся, а связи у нас lazy="raise" —
        # поэтому перечитываем рецепт целиком
        return await self.get(recipe.id)

    async def update(self, recipe_id: int, data: dict) -> Recipe | None:
        """
        Частичное обновление. None, если рецепта нет.
        Если ingredients / equipment переданы — список заменяется целиком
        (пустой список очищает). Если не переданы — не трогаются.
        """
        data = dict(data)
        ingredients = data.pop("ingredients", None)
        equipment = data.pop("equipment", None)

        try:
            if data:
                result = await self.session.execute(
                    update(Recipe)
                    .where(Recipe.id == recipe_id)
                    .values(**data)
                    .returning(Recipe.id)
                )
                if result.scalar_one_or_none() is None:
                    await self.session.rollback()
                    return None
            else:
                exists = await self.session.execute(
                    select(Recipe.id).where(Recipe.id == recipe_id)
                )
                if exists.scalar_one_or_none() is None:
                    return None

            if ingredients is not None:
                await self.session.execute(
                    delete(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe_id)
                )
                self.session.add_all(_ingredient_rows(recipe_id, ingredients))

            if equipment is not None:
                await self.session.execute(
                    delete(RecipeEquipment).where(RecipeEquipment.recipe_id == recipe_id)
                )
                self.session.add_all(_equipment_rows(recipe_id, equipment))

            await self.session.commit()
        except IntegrityError:
            # рецепт удалили параллельно (FK при вставке дочерних строк)
            await self.session.rollback()
            return None

        return await self.get(recipe_id)

    async def delete(self, recipe_id: int) -> bool:
        """Реакции, impressions, ингредиенты и оборудование удаляются каскадом (ON DELETE CASCADE)."""
        result = await self.session.execute(
            delete(Recipe).where(Recipe.id == recipe_id).returning(Recipe.id)
        )
        deleted = result.scalar_one_or_none() is not None
        await self.session.commit()
        return deleted