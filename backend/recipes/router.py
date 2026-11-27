import functools
import logging
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_session
from models import IngredientQuantity, ReactionAction, Recipe
from repos import RecipeRepository
from search import search_recipes
from jwks import get_optional_user_id, get_required_user_id
from me import load_preferences
from vocab import EQUIPMENT_CODES, FORBIDDEN_CODES, RECIPE_RELIGION_CODES, TAGS, clean_codes
from public_urls import to_public_media_url

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
        "image_url": to_public_media_url(recipe.image_url),
        "title": recipe.title,
        "description": recipe.description,
        "stars": recipe.stars,
        "hyper-text": to_public_media_url(recipe.hypertext_url),
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
        # forbidden / religions / equipment_codes фронту не отдаём — они для рекомендаций
        "tags": list(recipe.tags or []),
        "code": code,
        "state": state,
    }


# ---------- schemas ----------

class ReactionRequest(BaseModel):
    recipe_id: int
    action: Literal["like", "dislike", "favorite"]


class AnonymousNextRequest(BaseModel):
    """Тело POST/PATCH /next для незарегистрированного пользователя:
    его лайки/дизлайки из локального кэша клиента (для скора рекомендателя),
    уже показанные рецепты и ограничения.
    Предпочтения можно прислать как у /api/db/me/preferences
    (allergies, diets, religions, kitchen_equipment) или в старом виде
    (forbidden = аллергии, religions = религия + диеты)."""

    liked: list[int] = Field(default_factory=list, max_length=10000)
    disliked: list[int] = Field(default_factory=list, max_length=10000)
    exclude: list[int] = Field(
        default_factory=list,
        max_length=10000,
        description="id, которые клиент уже держит в очереди",
    )
    excluded_recipe_ids: list[int] = Field(
        default_factory=list,
        max_length=10000,
        description="уже показанные гостю id, свежие в конце (обычно последние 50)",
    )
    forbidden: list[str] = Field(
        default_factory=list,
        max_length=50,
        description="аллергии (старое имя поля): " + ", ".join(FORBIDDEN_CODES),
    )
    allergies: list[str] = Field(
        default_factory=list,
        max_length=50,
        description="аллергии, как в preferences: " + ", ".join(FORBIDDEN_CODES),
    )
    religions: list[str] = Field(
        default_factory=list,
        max_length=10,
        description="религия и/или диеты: " + ", ".join(RECIPE_RELIGION_CODES),
    )
    diets: list[str] = Field(
        default_factory=list,
        max_length=10,
        description="диеты, объединяются с religions",
    )
    kitchen_equipment: list[str] = Field(
        default_factory=list,
        max_length=50,
        description="оборудование клиента; бэк по нему не фильтрует",
    )


class ReactionsBulkRequest(BaseModel):
    """Тело PUT /liked, PUT /disliked и PUT /favorite: id рецептов из кэша клиента."""

    recipes: list[int] = Field(max_length=10000)


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
    kalories: int = Field(ge=0, default=100)  # на 100 г
    belki: int = Field(ge=0, default=10)  # на 100 г
    fats: int = Field(ge=0, default=10)  # на 100 г
    uglevods: int = Field(ge=0, default=10)  # на 100 г
    final_weight: int = Field(ge=1, default=100)
    ingredients: list[IngredientSchema] = Field(default_factory=list)
    equipment: list[str] = Field(
        default_factory=list,
        description="необходимое оборудование: блендер, большая зелёная чашка и т.д.",
    )
    tags: list[str] = Field(default_factory=list, description="коды из: " + ", ".join(TAGS))
    # ограничения рецепта (что он нарушает); в ответах не отдаются
    forbidden: list[str] = Field(
        default_factory=list, description="нарушает: " + ", ".join(FORBIDDEN_CODES)
    )
    religions: list[str] = Field(
        default_factory=list, description="нарушает: " + ", ".join(RECIPE_RELIGION_CODES)
    )
    equipment_codes: list[str] = Field(
        default_factory=list, description="нужное оборудование: " + ", ".join(EQUIPMENT_CODES)
    )

    @field_validator("image_url", "hypertext_url")
    @classmethod
    def _rel_media_urls(cls, v: str) -> str:
        return to_public_media_url(v) or v

    @model_validator(mode="after")
    def _check_equipment(self):
        self.equipment = _clean_equipment(self.equipment)
        return self

    @field_validator("tags", "forbidden", "religions", "equipment_codes")
    @classmethod
    def _check_codes(cls, v: list[str], info) -> list[str]:
        return _clean_recipe_codes(v, info.field_name)


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
    kalories: int | None = Field(default=None, ge=0)  # на 100 г
    belki: int | None = Field(default=None, ge=0)  # на 100 г
    fats: int | None = Field(default=None, ge=0)  # на 100 г
    uglevods: int | None = Field(default=None, ge=0)  # на 100 г
    final_weight: int | None = Field(default=None, ge=1)
    ingredients: list[IngredientSchema] | None = None
    equipment: list[str] | None = None
    tags: list[str] | None = None
    forbidden: list[str] | None = None
    religions: list[str] | None = None
    equipment_codes: list[str] | None = None

    @field_validator("image_url", "hypertext_url")
    @classmethod
    def _rel_media_urls(cls, v: str | None) -> str | None:
        return None if v is None else (to_public_media_url(v) or v)

    @field_validator("tags", "forbidden", "religions", "equipment_codes")
    @classmethod
    def _check_codes(cls, v: list[str] | None, info) -> list[str] | None:
        return None if v is None else _clean_recipe_codes(v, info.field_name)

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


_RECIPE_CODES = {
    "tags": TAGS,
    "forbidden": FORBIDDEN_CODES,
    "religions": RECIPE_RELIGION_CODES,
    "equipment_codes": EQUIPMENT_CODES,
}


def _clean_recipe_codes(values: list[str], field: str) -> list[str]:
    return clean_codes(values, _RECIPE_CODES[field], field)


def _clean_equipment(items: list[str]) -> list[str]:
    cleaned = [s.strip() for s in items]
    if any(not s or len(s) > 128 for s in cleaned):
        raise ValueError("название оборудования: от 1 до 128 символов")
    return cleaned


_MAX_REACTION_IDS = 1000
_INT32_MIN, _INT32_MAX = -2_147_483_648, 2_147_483_647


def _parse_reaction_ids(raw: list[str] | None) -> list[int] | None:
    """None — параметр ids не передан (очистить весь список).
    ValueError — мусор в ids или больше 1000 значений."""
    if raw is None:
        return None
    parts: list[str] = []
    for item in raw:
        parts.extend(p.strip() for p in item.split(","))
    parts = [p for p in parts if p]
    if len(parts) > _MAX_REACTION_IDS:
        raise ValueError("too many ids")
    ids: list[int] = []
    for p in parts:
        try:
            n = int(p)
        except ValueError as exc:
            raise ValueError("invalid id") from exc
        if n < _INT32_MIN or n > _INT32_MAX:
            raise ValueError("invalid id")
        ids.append(n)
    return ids


# ---------- endpoints ----------
@router.get("/next")
@handle_db_errors
async def get_next_recipe(
    exclude: list[int] = Query(default=[], description="id, которые клиент уже держит в очереди"),
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Только для авторизованных. Аноним без токена получит 401
    и должен использовать POST или PATCH /next. Рецепты, которые нарушают сохранённые
    аллергии и религию/диеты пользователя, не выдаются.
    Дальше выбор делает рекомендатель: лента циклическая, уже показанные
    и оценённые могут вернуться (дизлайкнутые — с штрафом)."""
    repo = RecipeRepository(session)
    # сохранённые фильтры пользователя (GET/PATCH /api/db/me/preferences) —
    # как forbidden/religions в анонимном POST/PATCH /next; по оборудованию не фильтруем
    prefs = await load_preferences(session, user_id)
    recipe = await repo.get_next(
        user_id,
        exclude,
        # у рецепта аллергии лежат в forbidden, религия и диеты — в religions
        forbidden=prefs["allergies"],
        religions=[*prefs["religions"], *prefs["diets"]],
    )

    if recipe is None:
        # рецепты закончились — это успех, а не ошибка
        return {"recipes": []}

    if user_id is not None:
        await repo.mark_shown(user_id, recipe.id)

    return {"recipe_id": recipe.id, "code": 200, "state": "OK"}


async def _anonymous_next(body: AnonymousNextRequest, session: AsyncSession):
    """Общая выдача /next для гостя (POST и PATCH)."""
    try:
        forbidden = clean_codes(
            [*body.forbidden, *body.allergies], FORBIDDEN_CODES, "forbidden"
        )
        religions = clean_codes(
            [*body.religions, *body.diets], RECIPE_RELIGION_CODES, "religions"
        )
    except ValueError:
        return _error(422, "Unprocessable Entity")
    recipe = await RecipeRepository(session).get_next(
        None,
        list(body.exclude),
        forbidden=forbidden,
        religions=religions,
        liked=body.liked,
        disliked=body.disliked,
        excluded_recipe_ids=body.excluded_recipe_ids,
    )

    if recipe is None:
        return {"recipes": []}

    return {"recipe_id": recipe.id, "code": 200, "state": "OK"}


@router.post("/next")
@handle_db_errors
async def post_next_recipe(
    body: AnonymousNextRequest,
    session: AsyncSession = Depends(get_session),
):
    """Выдача для незарегистрированного пользователя: клиент присылает
    лайкнутые и дизлайкнутые id из своего кэша — их передаём в рекомендатель
    (лайк повышает теги, дизлайк понижает, но рецепт из круга не выкидываем).
    excluded_recipe_ids — уже показанные (свежие в конце): штраф recency,
    пока есть другие кандидаты их не отдаём, иначе цикл с самого давнего.
    exclude — id, которые клиент уже держит в очереди, сейчас не отдаём.
    allergies / diets / religions (или старые forbidden / religions) —
    аллергии и религия/диеты: рецепты, которые их нарушают, не выдаются.
    kitchen_equipment принимается, но по нему не фильтруем.
    Неизвестный код -> 422. Ничего в БД не записывается.
    POST сохранён для совместимости; фронт шлёт PATCH."""
    return await _anonymous_next(body, session)


@router.patch("/next")
@handle_db_errors
async def patch_next_recipe(
    body: AnonymousNextRequest,
    session: AsyncSession = Depends(get_session),
):
    """То же, что POST /next: гостевая выдача со списком уже показанных."""
    return await _anonymous_next(body, session)


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

async def _put_reactions_bulk(
    user_id: str, recipe_ids: list[int], action: ReactionAction, session: AsyncSession
) -> dict:
    applied = await RecipeRepository(session).set_reactions_bulk(user_id, recipe_ids, action)
    skipped = sorted(set(recipe_ids) - set(applied))
    return {"code": 200, "state": "OK", "recipes": applied, "skipped": skipped}


@router.put("/liked")
@handle_db_errors
async def put_liked(
    body: ReactionsBulkRequest,
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Перенос лайков из кэша клиента в аккаунт (например, после регистрации).
    Добавляет к уже имеющимся; если на рецепт стоял дизлайк — он заменяется лайком.
    Несуществующие id пропускаются и возвращаются в skipped."""
    return await _put_reactions_bulk(user_id, body.recipes, ReactionAction.LIKE, session)


@router.put("/disliked")
@handle_db_errors
async def put_disliked(
    body: ReactionsBulkRequest,
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """То же для дизлайков; лайк на том же рецепте заменяется дизлайком."""
    return await _put_reactions_bulk(user_id, body.recipes, ReactionAction.DISLIKE, session)


@router.put("/favorite")
@handle_db_errors
async def put_favorite(
    body: ReactionsBulkRequest,
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Перенос избранного из кэша клиента в аккаунт. Favorite независим от like/dislike."""
    return await _put_reactions_bulk(user_id, body.recipes, ReactionAction.FAVORITE, session)


@router.get("/favorite")
async def get_favorite(
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    ids = await RecipeRepository(session).get_favourite(user_id)
    return {"code": 200, "state": "OK", "recipes": ids}


@router.get("/favorite/search")
@handle_db_errors
async def search_favorite(
    q: str | None = Query(
        default=None,
        description="Что ищем: слова из названия, теги по-русски, категории "
        "(«лимоны», «суп», «алкоголь»). Пусто — всё избранное.",
    ),
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Поиск по избранному текущего пользователя. Возвращает только id —
    карточки фронт берёт из своего кэша. Сортировка по релевантности
    (правила — в search.py), пустой q — всё избранное в порядке GET /favorite."""
    recipes = await RecipeRepository(session).get_favourite_brief(user_id)
    return {"code": 200, "state": "OK", "recipes": search_recipes(q, recipes)}


def _ids_query(
    ids: list[str] | None = Query(
        default=None,
        description="id через запятую (?ids=1,2,3) или повторно (?ids=1&ids=2). "
        "Не передан — очистить весь список. Не больше 1000.",
    ),
) -> list[str] | None:
    return ids


async def _delete_one_reaction(
    user_id: str, recipe_id: int, action: ReactionAction, session: AsyncSession
):
    removed = await RecipeRepository(session).remove_reaction(user_id, recipe_id, action)
    if removed is None:
        return _error(404, "Not Found")
    return {"code": 200, "state": "OK", "removed": removed}


async def _delete_reactions_bulk(
    user_id: str, raw_ids: list[str] | None, action: ReactionAction, session: AsyncSession
):
    try:
        ids = _parse_reaction_ids(raw_ids)
    except ValueError:
        return _error(422, "Unprocessable Entity")
    removed = await RecipeRepository(session).remove_reactions(user_id, action, ids)
    return {"code": 200, "state": "OK", "recipes": removed}


@router.delete("/favorite/{recipe_id}")
@handle_db_errors
async def delete_favorite(
    recipe_id: int,
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Убрать рецепт из избранного. Лайк/дизлайк на нём не трогаем."""
    return await _delete_one_reaction(user_id, recipe_id, ReactionAction.FAVORITE, session)


@router.delete("/liked/{recipe_id}")
@handle_db_errors
async def delete_liked(
    recipe_id: int,
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Снять лайк. Избранное и дизлайк не трогаем."""
    return await _delete_one_reaction(user_id, recipe_id, ReactionAction.LIKE, session)


@router.delete("/disliked/{recipe_id}")
@handle_db_errors
async def delete_disliked(
    recipe_id: int,
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Снять дизлайк. Impression не удаляется: рецепт в /next не вернётся."""
    return await _delete_one_reaction(user_id, recipe_id, ReactionAction.DISLIKE, session)


@router.delete("/favorite")
@handle_db_errors
async def delete_favorites(
    ids: list[str] | None = Depends(_ids_query),
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Удалить выбранные id из избранного или очистить весь список."""
    return await _delete_reactions_bulk(user_id, ids, ReactionAction.FAVORITE, session)


@router.delete("/liked")
@handle_db_errors
async def delete_liked_list(
    ids: list[str] | None = Depends(_ids_query),
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Удалить выбранные id из лайков или очистить весь список."""
    return await _delete_reactions_bulk(user_id, ids, ReactionAction.LIKE, session)


@router.delete("/disliked")
@handle_db_errors
async def delete_disliked_list(
    ids: list[str] | None = Depends(_ids_query),
    user_id: str = Depends(get_required_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Удалить выбранные id из дизлайков или очистить весь список.
    Impression не трогаем."""
    return await _delete_reactions_bulk(user_id, ids, ReactionAction.DISLIKE, session)


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
