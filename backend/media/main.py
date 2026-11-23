import logging
from contextlib import asynccontextmanager
from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from db import engine
from models import Base
from router import router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(title="Media service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- все ошибки в формате контракта {"code", "state"} ----------

def _contract_error(code: int, headers: dict | None = None) -> JSONResponse:
    try:
        state = HTTPStatus(code).phrase
    except ValueError:
        state = "Error"
    return JSONResponse(status_code=code, content={"code": code, "state": state}, headers=headers)


@app.exception_handler(StarletteHTTPException)
async def http_exc_handler(request: Request, exc: StarletteHTTPException):
    return _contract_error(exc.status_code, getattr(exc, "headers", None))


@app.exception_handler(RequestValidationError)
async def validation_exc_handler(request: Request, exc: RequestValidationError):
    return _contract_error(422)


@app.exception_handler(SQLAlchemyError)
async def db_exc_handler(request: Request, exc: SQLAlchemyError):
    logger.exception("database error")
    return _contract_error(500)


app.include_router(router)


@app.get("/health")
async def health():
    return {"200": "ok"}
