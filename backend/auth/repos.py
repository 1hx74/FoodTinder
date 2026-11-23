"""Классы-обёртки над БД. Коммитом управляет вызывающий код (router),
чтобы несколько операций можно было сделать атомарно."""
from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from models import Member, PendingPasswordReset, PendingRegistration, RefreshToken


class MemberRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, user_id: str) -> Member | None:
        return self.db.execute(
            select(Member).where(Member.id == user_id)
        ).scalar_one_or_none()

    def get_by_name(self, name: str) -> Member | None:
        return self.db.execute(
            select(Member).where(Member.name == name)
        ).scalar_one_or_none()

    def get_name_by_id(self, user_id: str) -> str | None:
        return self.db.execute(
            select(Member.name).where(Member.id == user_id)
        ).scalar_one_or_none()
    
    def get_by_email(self, email: str)->str|None:
        return self.db.execute(
            select(Member).where(Member.email == email)
        ).scalar_one_or_none()
    
    def name_exists(self, name: str) -> bool:
        return self.db.execute(
            select(Member.id).where(Member.name == name)
        ).scalar() is not None

    def email_exists(self, email: str) -> bool:
        return self.db.execute(
            select(Member.id).where(Member.email == email)
        ).scalar() is not None

    def create(
        self, *, user_id: str, email: str, name: str, password_hash: str, salt: str,
        role: str = "user",
    ) -> Member:
        member = Member(
            id=user_id,
            email=email,
            name=name,
            password_hash=password_hash,
            salt=salt,
            created_at=datetime.now(),
            role=role,
        )
        self.db.add(member)
        return member

    def set_password(self, user_id: str, password_hash: str, salt: str) -> None:
        self.db.execute(
            update(Member)
            .where(Member.id == user_id)
            .values(password_hash=password_hash, salt=salt)
        )



class RefreshTokenRepository:
    def __init__(self, db: Session):
        self.db = db

    def add(self, *, jti: str, user_id: str, expires_at: datetime) -> RefreshToken:
        row = RefreshToken(jti=jti, user_id=user_id, expires_at=expires_at)
        self.db.add(row)
        return row

    def get(self, jti: str) -> RefreshToken | None:
        return self.db.execute(
            select(RefreshToken).where(RefreshToken.jti == jti)
        ).scalar_one_or_none()

    def revoke(self, jti: str) -> None:
        self.db.execute(
            update(RefreshToken).where(RefreshToken.jti == jti).values(revoked=True)
        )

    def revoke_all_for_user(self, user_id: str) -> None:
        self.db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user_id)
            .values(revoked=True)
        )


class PendingRepository:
    """Незавершённые регистрации и смены пароля (ждут код с почты)."""

    def __init__(self, db: Session):
        self.db = db

    def purge_expired(self) -> None:
        now = datetime.now()
        self.db.execute(
            delete(PendingRegistration).where(PendingRegistration.expires_at <= now)
        )
        self.db.execute(
            delete(PendingPasswordReset).where(PendingPasswordReset.expires_at <= now)
        )

    # --- регистрация
    def put_registration(
        self, *, email: str, name: str, password_hash: str, salt: str, expires_at: datetime
    ) -> None:
        """Создаёт или заменяет (повторный запрос) незавершённую регистрацию."""
        self.db.merge(PendingRegistration(
            email=email, name=name, password_hash=password_hash,
            salt=salt, expires_at=expires_at,
        ))

    def get_registration(self, email: str) -> PendingRegistration | None:
        return self.db.execute(
            select(PendingRegistration).where(
                PendingRegistration.email == email,
                PendingRegistration.expires_at > datetime.now(),
            )
        ).scalar_one_or_none()

    def name_pending(self, name: str, except_email: str) -> bool:
        """Имя уже занято чужой незавершённой регистрацией."""
        return self.db.execute(
            select(PendingRegistration.email).where(
                PendingRegistration.name == name,
                PendingRegistration.email != except_email,
                PendingRegistration.expires_at > datetime.now(),
            )
        ).first() is not None

    def delete_registration(self, email: str) -> None:
        self.db.execute(
            delete(PendingRegistration).where(PendingRegistration.email == email)
        )

    # --- восстановление пароля
    def put_reset(
        self, *, email: str, password_hash: str, salt: str, expires_at: datetime
    ) -> None:
        self.db.merge(PendingPasswordReset(
            email=email, password_hash=password_hash, salt=salt, expires_at=expires_at,
        ))

    def get_reset(self, email: str) -> PendingPasswordReset | None:
        return self.db.execute(
            select(PendingPasswordReset).where(
                PendingPasswordReset.email == email,
                PendingPasswordReset.expires_at > datetime.now(),
            )
        ).scalar_one_or_none()

    def delete_reset(self, email: str) -> None:
        self.db.execute(
            delete(PendingPasswordReset).where(PendingPasswordReset.email == email)
        )
