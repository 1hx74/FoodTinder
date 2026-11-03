from contextlib import asynccontextmanager

from fastapi import FastAPI

from db import engine
from models import Base
from router import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(title="Recipes service", lifespan=lifespan)
app.include_router(router)

@app.get("/health")
async def health():
    return {"200": "ok"}