from datetime import date
from typing import Optional

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    email: str = Field(min_length=1, max_length=320)
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1)


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