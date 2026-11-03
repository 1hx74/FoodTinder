from collections.abc import Sequence

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models import Recipe, ReactionAction, RecipeImpression, RecipeReaction


class RecipeRepository:
    """Все операции с БД, нужные эндпоинтам. Рассчитано на PostgreSQL."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, recipe_id: int) -> Recipe | None:
        return await self.session.get(Recipe, recipe_id)

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

    # ---------- управление рецептами ----------

    async def create(self, data: dict) -> Recipe:
        recipe = Recipe(**data)
        self.session.add(recipe)
        await self.session.commit()
        return recipe

    async def update(self, recipe_id: int, data: dict) -> Recipe | None:
        """Частичное обновление одним запросом. None, если рецепта нет."""
        result = await self.session.execute(
            update(Recipe).where(Recipe.id == recipe_id).values(**data).returning(Recipe)
        )
        recipe = result.scalar_one_or_none()
        await self.session.commit()
        return recipe

    async def delete(self, recipe_id: int) -> bool:
        """Реакции и impressions удаляются каскадом (ON DELETE CASCADE)."""
        result = await self.session.execute(
            delete(Recipe).where(Recipe.id == recipe_id).returning(Recipe.id)
        )
        deleted = result.scalar_one_or_none() is not None
        await self.session.commit()
        return deleted