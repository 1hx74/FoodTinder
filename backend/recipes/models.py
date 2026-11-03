from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class ReactionAction(str, enum.Enum):
    LIKE = "like"
    DISLIKE = "dislike"
    FAVORITE = "favorite"


class Recipe(Base):
    __tablename__ = "recipes"
    __table_args__ = (
        CheckConstraint("cooking_time >= 1", name="ck_recipes_cooking_time"),
        CheckConstraint("difficulty BETWEEN 1 AND 5", name="ck_recipes_difficulty"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(String(512))
    image_url: Mapped[str] = mapped_column(String)
    stars: Mapped[int] = mapped_column(Integer) # сколько раз звездили рецепт
    hypertext_url: Mapped[str] = mapped_column(String) # ссыдка на хэтэмэлэ файл рецепта
    cooking_time: Mapped[int] = mapped_column(Integer)  # минуты
    difficulty: Mapped[int] = mapped_column(Integer)  # 1..5


class RecipeReaction(Base):
    """Реакция пользователя. like/dislike взаимоисключающие, favorite независим."""

    __tablename__ = "recipe_reactions"
    __table_args__ = (
        UniqueConstraint("user_id", "recipe_id", "action", name="uq_reaction_user_recipe_action"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # sub из JWT; отдельной таблицы пользователей в этом сервисе нет
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), index=True
    )
    action: Mapped[ReactionAction] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RecipeImpression(Base):
    """Рецепт, уже выданный пользователю через /next (чтобы очередь на клиенте не получала дубли)."""

    __tablename__ = "recipe_impressions"
    __table_args__ = (UniqueConstraint("user_id", "recipe_id", name="uq_impression_user_recipe"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())