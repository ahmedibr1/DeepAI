"""In-portal notifications, with an outbox hook for email / Microsoft Teams later.

To add a channel: implement `Channel.enqueue`, register it in CHANNELS, and run a delivery worker
that drains `notification_deliveries`. Callers of `notify()` do not change.
"""
import uuid
from typing import Protocol

from sqlalchemy.orm import Session

from app.models import Notification, NotificationDelivery


class Channel(Protocol):
    name: str

    def enqueue(self, db: Session, notification: Notification) -> None: ...


class OutboxChannel:
    def __init__(self, name: str):
        self.name = name

    def enqueue(self, db: Session, notification: Notification) -> None:
        db.add(NotificationDelivery(notification_id=notification.id, channel=self.name))


CHANNELS: list[Channel] = []  # e.g. [OutboxChannel("email"), OutboxChannel("teams")] once workers exist


def notify(db: Session, user_ids: list[uuid.UUID], type_: str, title: str, *, body: str | None = None,
           opportunity_id: uuid.UUID | None = None, payload: dict | None = None) -> None:
    for uid in dict.fromkeys(u for u in user_ids if u):
        n = Notification(id=uuid.uuid4(), user_id=uid, type=type_, title=title, body=body,
                         opportunity_id=opportunity_id, payload=payload)
        db.add(n)
        for ch in CHANNELS:
            ch.enqueue(db, n)
