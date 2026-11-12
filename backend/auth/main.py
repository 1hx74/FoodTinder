from contextlib import asynccontextmanager
import fastapi
from fastapi.middleware.cors import CORSMiddleware

from models import Base, engine
from router import router, wellknown_router
from repos import MemberRepository

@asynccontextmanager
async def lifespan(app: fastapi.FastAPI):
    Base.metadata.create_all(engine)  # создаёт таблицы, если их ещё нет
    yield


app = fastapi.FastAPI(title="Auth service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
app.include_router(wellknown_router)

@app.get("/health")
async def root():
    return {200: "ok"}
