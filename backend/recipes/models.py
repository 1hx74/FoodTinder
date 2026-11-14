from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class ReactionAction(str, enum.Enum):
    LIKE = "like"
    DISLIKE = "dislike"
    FAVORITE = "favorite"


class IngredientQuantity(str, enum.Enum):
    """Единица измерения ингредиента."""

    GRAMM = "gramm"
    ITEM = "item"
    MILLILITER = "milliliter"


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
    stars: Mapped[int] = mapped_column(Integer)  # сколько раз звездили рецепт
    hypertext_url: Mapped[str] = mapped_column(String)  # ссылка на html-файл рецепта
    cooking_time: Mapped[int] = mapped_column(Integer)  # минуты
    difficulty: Mapped[int] = mapped_column(Integer)  # 1..5
    kalories: Mapped[int] = mapped_column(Integer) # калории
    belki: Mapped[int] = mapped_column(Integer) # белки
    fats: Mapped[int] = mapped_column(Integer) # жиры
    uglevods: Mapped[int] = mapped_column(Integer) # углеводы
    final_weight: Mapped[int] = mapped_column(Integer) # финальный вес

    # lazy="raise": случайная ленивая подгрузка в async-коде сразу падает,
    # а не даёт загадочный MissingGreenlet. Грузим явно через selectinload в репозитории.
    ingredients: Mapped[list[RecipeIngredient]] = relationship(
        lazy="raise",
        order_by="RecipeIngredient.id",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    equipment: Mapped[list[RecipeEquipment]] = relationship(
        lazy="raise",
        order_by="RecipeEquipment.id",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class RecipeIngredient(Base):
    """Ингридиенты для рецепта"""
    __tablename__ = "recipe_ingredients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(64))
    quantity: Mapped[IngredientQuantity] = mapped_column(String(16))  # значение IngredientQuantity
    count: Mapped[float] = mapped_column(Float)


class RecipeEquipment(Base):
    """Необходимое оборудование: блендер, большая зелёная чашка и т.д."""

    __tablename__ = "recipe_equipment"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(128))


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