import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.errors import not_found
from app.db import get_db
from app.models import Notification, User
from app.schemas.common import NotificationOut

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationOut])
def list_notifications(unread_only: bool = False, limit: int = Query(30, ge=1, le=100), db: Session = Depends(get_db),
                       user: User = Depends(current_user)):
    stmt = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    return db.execute(stmt.order_by(Notification.created_at.desc()).limit(limit)).scalars().all()


@router.post("/{notification_id}/read", status_code=204)
def mark_read(notification_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise not_found("Notification")
    n.read_at = n.read_at or datetime.now(UTC)
    db.commit()


@router.post("/read-all", status_code=204)
def mark_all_read(db: Session = Depends(get_db), user: User = Depends(current_user)):
    db.execute(update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
               .values(read_at=datetime.now(UTC)))
    db.commit()
