from typing import Optional
from datetime import datetime

from sqlalchemy import (
    ForeignKey, Text, CheckConstraint, DateTime, Boolean, JSON, String, SmallInteger
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, DeclarativeBase


class Base(DeclarativeBase):
    pass

# Базовые данные о пользователе, необходимы для логина/регистрации
class Member(Base):
    __tablename__ = "members"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(Text)
    salt: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime)

# Расширенные данные о пользователе, необходимы для персонализации
class MemberData(Base):
    __tablename__ = "member_data"

    id: Mapped[str] = mapped_column(ForeignKey("members.id"), primary_key=True)
    birthday: Mapped[Optional[datetime]] = mapped_column(DateTime)
    height: Mapped[Optional[int]] = mapped_column(SmallInteger)
    weight: Mapped[Optional[int]] = mapped_column(SmallInteger)
    sex: Mapped[Optional[str]] = mapped_column(Text)
    
    __table_args__ = (
        CheckConstraint("sex IN ('male', 'female')", name="ck_chat_member_sex"),
    )

## Таблица для предвопчтений юзеров, TODO
class Attraction(Base):
    __tablename__ = "attractions"
    id: Mapped[str] = mapped_column(ForeignKey("members.id"), primary_key=True)

## Токены, для аутентификации юзеров
class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    jti: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("members.id"))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)

## База с файлами (картинки рецептов и тд)
class UrlFile(Base):
    __tablename__ = "files"

    url: Mapped[str] = mapped_column(Text, primary_key=True)
    original_name: Mapped[str] = mapped_column(Text, nullable=False)