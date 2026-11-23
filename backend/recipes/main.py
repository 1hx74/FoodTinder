import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from db import SessionFactory, engine
from models import Base
from router import router
from fastapi.exceptions import RequestValidationError
from me import router as me_router, validation_error_handler
from migrations import upgrade_schema
from seed import backfill_demo_meta, seed_demo_recipes
from fastapi.middleware.cors import CORSMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # create_all не добавляет колонки в уже существующие таблицы
        await upgrade_schema(conn)
    if os.getenv("SEED_DEMO_RECIPES", "false").lower() == "true":
        async with SessionFactory() as session:
            await seed_demo_recipes(session)
            # демо-рецептам из старой БД (до появления тегов) проставляем теги/ограничения
            await backfill_demo_meta(session)
    yield
    await engine.dispose()


app = FastAPI(title="Recipes service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(me_router)
app.add_exception_handler(RequestValidationError, validation_error_handler)

@app.get("/health")
async def health():
    return {"200": "ok"}