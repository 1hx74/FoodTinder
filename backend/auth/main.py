from contextlib import asynccontextmanager
import fastapi
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from models import Base, engine
from router import router, wellknown_router
from repos import MemberRepository
from errors import ApiError
from service_admin import ensure_service_admin

@asynccontextmanager
async def lifespan(app: fastapi.FastAPI):
    Base.metadata.create_all(engine)  # создаёт таблицы, если их ещё нет
    ensure_service_admin()             # служебный admin из корневого .env
    yield


app = fastapi.FastAPI(title="Auth service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- ошибки в формате контракта {"code", "state"} (регистрация / восстановление пароля)
_CONTRACT_PATHS = {
    "/api/auth/register",
    "/api/auth/register/verify",
    "/api/auth/password/recover",
    "/api/auth/password/recover/verify",
    "/api/auth/change_pswd",
}


@app.exception_handler(ApiError)
async def api_error_handler(request: fastapi.Request, exc: ApiError):
    return exc.to_response()


@app.exception_handler(RequestValidationError)
async def validation_handler(request: fastapi.Request, exc: RequestValidationError):
    if request.url.path in _CONTRACT_PATHS:
        return ApiError(422, "Unprocessable Entity").to_response()
    return await request_validation_exception_handler(request, exc)


app.include_router(router)
app.include_router(wellknown_router)

@app.get("/health")
async def root():
    return {200: "ok"}
