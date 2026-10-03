"""Opportunity Attention Monitor.

Every active opportunity is listed, so management can watch the whole portfolio, with high-priority
support needs and high-impact risks highlighted. All of it is read from the DeepDive of the current
version, so nothing is entered twice.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.enums import STATUS_LABELS, OpportunityStatus
from app.models import DeepDiveData, Opportunity, OpportunityVersion, Team, User
from app.services.access import scope_opportunities

HIGH = {"high", "critical"}
FAR_FUTURE = date(9999, 12, 31)
SCOPE_PREVIEW_CHARS = 600


def _parse_date(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _days_between(start: date | None, end: date) -> int | None:
    return (end - start).days if start else None


def _items(data: dict) -> tuple[list[dict], list[dict]]:
    """High-priority support requests and high-impact risks: what management is asked to watch."""
    support = [
        {"need": i.get("need", ""), "priority": i.get("priority", ""), "from": i.get("from", ""),
         "due_date": i.get("date") or None}
        for i in (data.get("support") or [])
        if isinstance(i, dict) and str(i.get("priority", "")).strip().lower() in HIGH
    ]
    risks = []
    for key, category in (("riskTech", "Technical"), ("riskFin", "Financial / Commercial")):
        risks += [
            {"risk": i.get("risk", ""), "category": category, "impact": i.get("impact", ""),
             "mitigation": i.get("mitigation", ""), "owner": i.get("owner", ""), "due_date": i.get("date") or None}
            for i in (data.get(key) or [])
            if isinstance(i, dict) and str(i.get("impact", "")).strip().lower() in HIGH
        ]
    return support, risks


def _scope(data: dict) -> str:
    text = " ".join(str(data.get("sow") or "").split())
    return text[:SCOPE_PREVIEW_CHARS] + ("…" if len(text) > SCOPE_PREVIEW_CHARS else "")


def _names(items: Any, *fields: str) -> list[str]:
    out = []
    for item in items or []:
        if isinstance(item, dict):
            for field in fields:
                value = str(item.get(field) or "").strip()
                if value:
                    out.append(value)
                    break
    return out


def monitor_rows(db: Session, user: User, *, query: str | None = None, team_id=None, limit: int = 300) -> list[dict]:
    stmt = (scope_opportunities(select(Opportunity, DeepDiveData.data), user)
            .join(OpportunityVersion, OpportunityVersion.id == Opportunity.current_version_id)
            .join(DeepDiveData, DeepDiveData.version_id == OpportunityVersion.id)
            .where(Opportunity.is_archived.is_(False), Opportunity.status != OpportunityStatus.COMPLETED))
    if query:
        like = f"%{query.strip()}%"
        stmt = stmt.where(or_(Opportunity.title.ilike(like), Opportunity.account_name.ilike(like),
                              Opportunity.opportunity_number.ilike(like)))
    if team_id:
        stmt = stmt.where(Opportunity.team_id == team_id)

    today = date.today()
    now = datetime.now(timezone.utc)
    rows: list[dict] = []
    for opp, data in db.execute(stmt).all():
        data = data or {}
        support, risks = _items(data)
        submission = _parse_date(data.get("submissionDate"))
        received = _parse_date(data.get("presalesReceived"))
        dates = [d for d in (_parse_date(i["due_date"]) for i in [*support, *risks]) if d]
        nearest = min(dates) if dates else None
        try:
            value = float(str(data.get("value") or "").replace(",", "") or 0)
        except ValueError:
            value = 0.0
        rows.append({
            "id": str(opp.id), "opportunity_number": opp.opportunity_number, "title": opp.title,
            "account_name": opp.account_name, "status": opp.status,
            "status_label": STATUS_LABELS[OpportunityStatus(opp.status)],
            "opportunity_type": opp.opportunity_type, "vertical": opp.vertical,
            "portfolio": opp.team.name if opp.team else None,
            "owner": opp.owner.full_name if opp.owner else None,
            "manager": opp.manager.full_name if opp.manager else None,
            "director": opp.director.full_name if opp.director else None,
            "estimated_value": value,
            "presales_received": received.isoformat() if received else None,
            "days_with_presales": _days_between(received, today),
            "submission_date": submission.isoformat() if submission else None,
            "days_remaining": _days_between(today, submission) if submission else None,
            "is_overdue_submission": bool(submission and submission < today),
            "attention_count": len(support) + len(risks),
            "support_count": len(support), "risk_count": len(risks),
            "nearest_due_date": nearest.isoformat() if nearest else None,
            "is_overdue": bool(nearest and nearest < today),
            "days_since_update": max((now - opp.updated_at).days, 0) if opp.updated_at else 0,
            "scope": _scope(data),
            "internal": _names(data.get("internal"), "unit"),
            "vendors": _names(data.get("vendors"), "name"),
            "support": sorted(support, key=lambda i: _parse_date(i["due_date"]) or FAR_FUTURE),
            "risks": sorted(risks, key=lambda i: _parse_date(i["due_date"]) or FAR_FUTURE),
        })

    # Nearest customer submission date first; opportunities without one go last.
    rows.sort(key=lambda r: (_parse_date(r["submission_date"]) or FAR_FUTURE, -r["attention_count"], r["title"]))
    return rows[:limit]


def opportunities_needing_attention(db: Session, user: User, limit: int = 50) -> list[dict]:
    """Only the ones with something to watch — used by the KPI count."""
    return [r for r in monitor_rows(db, user, limit=10_000) if r["attention_count"] > 0][:limit]


def count(db: Session, user: User) -> int:
    return len(opportunities_needing_attention(db, user, limit=10_000))


def portfolios(db: Session, user: User) -> list[dict]:
    teams = db.execute(select(Team).order_by(Team.name)).unique().scalars().all()
    return [{"id": str(t.id), "name": t.name} for t in teams]
