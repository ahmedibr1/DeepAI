import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import RoleKey
from app.db import Base
from app.models.base import Timestamped, enum_check, uuid_pk


class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (CheckConstraint(enum_check("key", RoleKey), name="role_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)


class Team(Timestamped, Base):
    """A portfolio: its Presales Account users, their Portfolio Presales Manager and Director."""

    __tablename__ = "teams"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    director_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", use_alter=True, ondelete="SET NULL"), unique=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    manager_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", use_alter=True, ondelete="SET NULL")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    director: Mapped["User | None"] = relationship(foreign_keys=[director_id], lazy="joined")
    manager: Mapped["User | None"] = relationship(foreign_keys=[manager_id], lazy="joined")
    sales_gm_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", use_alter=True, ondelete="SET NULL"))
    sales_gm: Mapped["User | None"] = relationship(foreign_keys=[sales_gm_id], lazy="joined")


class User(Timestamped, Base):
    __tablename__ = "users"
    __table_args__ = (Index("ix_users_username_lower", text("lower(username)"), unique=True),)

    id: Mapped[uuid.UUID] = uuid_pk()
    username: Mapped[str] = mapped_column(String(80), nullable=False)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str | None] = mapped_column(String(254))
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), nullable=False, index=True)
    team_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    token_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # bump = revoke all sessions
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    role: Mapped[Role] = relationship(lazy="joined")
    team: Mapped[Team | None] = relationship(foreign_keys=[team_id], lazy="joined")

    @property
    def role_key(self) -> RoleKey:
        return RoleKey(self.role.key)


class Vertical(Timestamped, Base):
    """A business vertical. Managed beside portfolios on the Portfolios / Verticals page."""

    __tablename__ = "verticals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sales_director_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", use_alter=True, ondelete="SET NULL"))
