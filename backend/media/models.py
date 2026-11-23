from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class UserAvatar(Base):
    """Текущий аватар пользователя: user_id (sub из JWT) -> id файла в fileloud."""

    __tablename__ = "user_avatars"

    user_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    file_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    content_type: Mapped[str] = mapped_column(String(64))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
