"""Классы-обёртки над БД. Коммитом управляет вызывающий код (router),
чтобы несколько операций можно было сделать атомарно."""
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from models import Member, RefreshToken


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
        self, *, user_id: str, email: str, name: str, password_hash: str, salt: str
    ) -> Member:
        member = Member(
            id=user_id,
            email=email,
            name=name,
            password_hash=password_hash,
            salt=salt,
            created_at=datetime.now(),
        )
        self.db.add(member)
        return member



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