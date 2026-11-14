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

    async def get_next(
        self,
        user_id: str | None,
        exclude: Sequence[int] = (),
    ) -> Recipe | None:
        """
        user_id=None  -> случайный рецепт (минус exclude, если клиент передал).
        user_id задан -> случайный рецепт, которого пользователь ещё не получал
                         и на который не реагировал.
        """
        stmt = select(Recipe)

        if exclude:
            stmt = stmt.where(Recipe.id.not_in(exclude))

        if user_id is not None:
            shown = (
                select(RecipeImpression.id)
                .where(
                    RecipeImpression.user_id == user_id,
                    RecipeImpression.recipe_id == Recipe.id,
                )
                .exists()
            )
            reacted = (
                select(RecipeReaction.id)
                .where(
                    RecipeReaction.user_id == user_id,
                    RecipeReaction.recipe_id == Recipe.id,
                )
                .exists()
            )
            stmt = stmt.where(~shown, ~reacted)

        # ORDER BY random() — нормально для небольших таблиц;
        # на больших лучше TABLESAMPLE или выбор по случайному id.
        stmt = stmt.order_by(func.random()).limit(1)

        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def mark_shown(self, user_id: str, recipe_id: int) -> None:
        stmt = (
            pg_insert(RecipeImpression)
            .values(user_id=user_id, recipe_id=recipe_id)
            .on_conflict_do_nothing(index_elements=["user_id", "recipe_id"])
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