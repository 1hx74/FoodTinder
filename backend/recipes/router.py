import functools
import logging
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_session
from models import IngredientQuantity, ReactionAction, Recipe
from repos import RecipeRepository
from jwks import get_optional_user_id, get_required_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/db/recipes", tags=["recipes"])

DEFAULT_USER_ID = "anonymous"


# ---------- helpers ----------

def _error(code: int, state: str) -> JSONResponse:
    return JSONResponse(status_code=code, content={"code": code, "state": state})


def handle_db_errors(func):
    """Любая ошибка БД -> 500 в формате контракта."""

    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except SQLAlchemyError:
            logger.exception("database error")
            return _error(500, "Internal Server Error")

    return wrapper


def _recipe_payload(recipe: Recipe, code: int = 200, state: str = "OK") -> dict:
    # recipe должен быть получен через repo.get()/create()/update(),
    # где ingredients и equipment уже загружены
    return {
        "recipe_id": recipe.id,
        "image_url": recipe.image_url,
        "title": recipe.title,
        "description": recipe.description,
        "stars": recipe.stars,
        "hyper-text": recipe.hypertext_url,
        "cooking_time": recipe.cooking_time,
        "difficulty": recipe.difficulty,
        "kalories": recipe.kalories,
        "belki": recipe.belki,
        "fats": recipe.fats,
        "uglevods": recipe.uglevods,
        "final_weight": recipe.final_weight,
        "ingredients": [
            {"name": i.name, "quantity": i.quantity, "count": i.count}
            for i in recipe.ingredients
        ],
        "equipment": [e.name for e in recipe.equipment],
        "code": code,
        "state": state,
    }


# ---------- schemas ----------

class ReactionRequest(BaseModel):
    recipe_id: int
    action: Literal["like", "dislike", "favorite"]


class IngredientSchema(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=64)
    quantity: IngredientQuantity
    count: float = Field(gt=0)


EquipmentName = str  # для читаемости; ограничения задаются в Field ниже


class RecipeCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=128)
    description: str = Field(min_length=1, max_length=512)
    image_url: str = Field(min_length=1)
    stars: int = Field(default=0, ge=0, le=5)
    hypertext_url: str = Field(alias="hyper-text", min_length=1)
    cooking_time: int = Field(ge=1, description="минуты")
    difficulty: int = Field(ge=1, le=5)
    kalories: int = Field(ge=1, default=100)
    belki: int = Field(ge=1, default=10)
    fats: int = Field(ge=1, default=10)
    uglevods: int = Field(ge=1, default=10)
    final_weight: int = Field(ge=1, default=100)
    ingredients: list[IngredientSchema] = Field(default_factory=list)
    equipment: list[str] = Field(
        default_factory=list,
        description="необходимое оборудование: блендер, большая зелёная чашка и т.д.",
    )

    @model_validator(mode="after")
    def _check_equipment(self):
        self.equipment = _clean_equipment(self.equipment)
        return self


class RecipeUpdate(BaseModel):
    """Частичное обновление: передаются только меняемые поля.
    ingredients / equipment, если переданы, заменяют список целиком."""

    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    title: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, min_length=1, max_length=512)
    image_url: str | None = Field(default=None, min_length=1)
    stars: int | None = Field(default=None, ge=0, le=5)
    hypertext_url: str | None = Field(default=None, alias="hyper-text", min_length=1)
    cooking_time: int | None = Field(default=None, ge=1, description="минуты")
    difficulty: int | None = Field(default=None, ge=1, le=5)
    kalories: int | None = Field(default=None, ge=1)
    belki: int | None = Field(default=None, ge=1)
    fats: int | None = Field(default=None, ge=1)
    uglevods: int | None = Field(default=None, ge=1)
    final_weight: int | None = Field(default=None, ge=1)
    ingredients: list[IngredientSchema] | None = None
    equipment: list[str] | None = None

    @model_validator(mode="after")
    def _validate(self):
        if not self.model_fields_set:
            raise ValueError("нужно передать хотя бы одно поле")
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"поле {name} не может быть null")
        if self.equipment is not None:
            self.equipment = _clean_equipment(self.equipment)
        return self


def _clean_equipment(items: list[str]) -> list[str]:
    cleaned = [s.strip() for s in items]
    if any(not s or len(s) > 128 for s in cleaned):
        raise ValueError("название оборудования: от 1 до 128 символов")
    return cleaned


# ---------- endpoints ----------
@router.get("/next")
@handle_db_errors
async def get_next_recipe(
    exclude: list[int] = Query(default=[], description="id, которые клиент уже держит в очереди"),
    user_id: str | None = Depends(get_optional_user_id),
    session: AsyncSession = Depends(get_session),
):
    repo = RecipeRepository(session)
    recipe = await repo.get_next(user_id, exclude)

    if recipe is None:
        # рецепты закончились — это успех, а не ошибка
        return {"recipes": []}

    if user_id is not None:
        await repo.mark_shown(user_id, recipe.id)

    return {"recipe_id": recipe.id, "code": 200, "state": "OK"}


@router.put("/reaction")
@handle_db_errors
async def put_reaction(
    body: ReactionRequest,
    user_id: str | None = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    repo = RecipeRepository(session)
    ok = await repo.set_reaction(
        user_id, body.recipe_id, ReactionAction(body.action)
    )
    if not ok:
        return _error(404, "Not Found")

    return {"code": 200, "state": "OK"}


@router.post("")
@handle_db_errors
async def create_recipe(
    body: RecipeCreate,
    user_id: str | None = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    recipe = await RecipeRepository(session).create(body.model_dump())
    return JSONResponse(status_code=201, content=_recipe_payload(recipe, 201, "Created"))

@router.get("/liked")
@handle_db_errors
async def get_liked(
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    ids = await RecipeRepository(session).get_liked(user_id)
    return {"code": 200, "state": "OK", "recipes": ids}


@router.get("/disliked")
@handle_db_errors
async def get_disliked(
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    ids = await RecipeRepository(session).get_disliked(user_id)
    return {"code": 200, "state": "OK", "recipes": ids}

@router.get("/favorite")
async def get_favorite(
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    ids = await RecipeRepository(session).get_favourite(user_id)
    return {"code": 200, "state": "OK", "recipes": ids}

@router.get("/{recipe_id}")
@handle_db_errors
async def get_recipe(
    recipe_id: int,
    session: AsyncSession = Depends(get_session),
):
    recipe = await RecipeRepository(session).get(recipe_id)
    if recipe is None:
        return _error(404, "Not Found")
    return _recipe_payload(recipe)


@router.patch("/{recipe_id}")
@handle_db_errors
async def update_recipe(
    recipe_id: int,
    body: RecipeUpdate,
    user_id: str | None = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    recipe = await RecipeRepository(session).update(recipe_id, body.model_dump(exclude_unset=True))
    if recipe is None:
        return _error(404, "Not Found")
    return _recipe_payload(recipe)


@router.delete("/{recipe_id}")
@handle_db_errors
async def delete_recipe(
    recipe_id: int,
    user_id: str | None = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    if not await RecipeRepository(session).delete(recipe_id):
        return _error(404, "Not Found")
    return {"code": 200, "state": "OK"}
