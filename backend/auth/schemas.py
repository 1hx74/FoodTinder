from datetime import date
from typing import Optional

from pydantic import AliasChoices, BaseModel, Field


class RegisterRequest(BaseModel):
    email: str = Field(min_length=1, max_length=320)
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1)


# код с почты: ровно 6 цифр. Принимается и как "code" (фронт), и как
# "verification_code" (как в контракте email_verificator)
_CODE_FIELD = dict(
    validation_alias=AliasChoices("code", "verification_code"),
    pattern=r"^[0-9]{6}$",
)


class RegisterVerifyRequest(BaseModel):
    email: str = Field(min_length=1, max_length=320)
    code: str = Field(**_CODE_FIELD)


class PasswordRecoverRequest(BaseModel):
    email: str = Field(min_length=1, max_length=320)
    new_password: str = Field(min_length=1)


class PasswordRecoverVerifyRequest(BaseModel):
    email: str = Field(min_length=1, max_length=320)
    code: str = Field(**_CODE_FIELD)


# смена пароля залогиненным пользователем (без кода с почты).
# новый пароль — от 6 символов, как уже проверяет фронт на регистрации.
class ChangePasswordRequest(BaseModel):
    old_password: str = Field(min_length=1)
    new_password: str = Field(min_length=6)


class StateResponse(BaseModel):
    code: int = 200
    state: str = "OK"


class LoginRequest(BaseModel):
    email: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1)


class AuthResponse(BaseModel):
    ok: bool = True
    id: str
    access_token: str
    token_type: str = "bearer"


class RefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    name: str


class OkResponse(BaseModel):
    ok: bool = True


class MeResponse(BaseModel):
    ok: bool = True
    name: str
    role: str = "user"
    birthday: Optional[date] = None
    height: Optional[float] = None
    weight: Optional[float] = None
    sex: Optional[str] = None