import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from db import SessionFactory, engine
from models import Base
from router import router
from seed import seed_demo_recipes


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    if os.getenv("SEED_DEMO_RECIPES", "false").lower() == "true":
        async with SessionFactory() as session:
            await seed_demo_recipes(session)
    yield
    await engine.dispose()


app = FastAPI(title="Recipes service", lifespan=lifespan)
app.include_router(router)

@app.get("/health")
async def health():
    return {"200": "ok"}