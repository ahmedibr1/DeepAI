"""Audit trail. Written in the same transaction as the change it records (no silent gaps)."""
import ipaddress
import uuid
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditLog, User


def client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    fwd = request.headers.get("x-forwarded-for")  # set by the ingress controller
    candidate = (fwd.split(",")[0].strip() if fwd else None) or (request.client.host if request.client else None)
    try:
        return str(ipaddress.ip_address(candidate)) if candidate else None
    except ValueError:  # malformed or spoofed header: never let it break the audit write
        return None


def record(
    db: Session,
    action: str,
    *,
    actor: User | None = None,
    actor_username: str | None = None,
    request: Request | None = None,
    entity_type: str | None = None,
    entity_id: Any = None,
    opportunity_id: uuid.UUID | None = None,
    outcome: str = "success",
    details: dict | None = None,
) -> None:
    db.add(AuditLog(
        actor_id=actor.id if actor else None,
        actor_username=actor.username if actor else actor_username,
        action=action,
        outcome=outcome,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        opportunity_id=opportunity_id,
        ip_address=client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:400] if request else None,
        request_id=getattr(request.state, "request_id", None) if request else None,
        details=details,
    ))
