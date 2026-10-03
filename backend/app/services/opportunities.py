import hashlib
import json
import re
import uuid
from datetime import UTC, datetime

from fastapi import Request
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.enums import MANAGEMENT_ROLES, OpportunityStatus as St
from app.core.errors import conflict, forbidden, unprocessable
from app.models import DeepDiveData, Opportunity, OpportunityVersion, User, WorkflowHistory
from app.services.notifications import notify
from app.services import audit
from app.services.access import can_create_version, can_delete, can_edit_content


def normalize_number(raw: str) -> str:
    number = re.sub(r"\s+", "", raw or "").upper()
    if not re.fullmatch(get_settings().opportunity_number_pattern, number):
        raise unprocessable("Opportunity number format is not valid (e.g. OP-2026-159388).")
    return number


def _hash(data: dict) -> str:
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


# Fields the Create Opportunity record owns. They are written into every save so the DeepDive can never
# drift from the opportunity record, and the builder shows them read-only.
def portal_fields(opp: Opportunity) -> dict:
    return {
        "oppNumber": opp.opportunity_number,
        "oppName": opp.title,
        "customer": opp.account_name,
        "presalesOwner": opp.owner.full_name if opp.owner else "",
    }


def _sync_identity(opp: Opportunity, data: dict) -> dict:
    """The opportunity record is the master for the shared fields; the rest of the DeepDive is the user's."""
    return {**dict(data), **portal_fields(opp)}


def update_master_fields(db: Session, user: User, opp: Opportunity, fields: dict, request: Request) -> Opportunity:
    """Overview data lives on the opportunity, not in a version, so it is edited here."""
    if not can_edit_content(user, opp) and user.role_key not in MANAGEMENT_ROLES:
        raise forbidden("You cannot change this opportunity.")
    changed = {}
    for field in ("title", "account_name", "opportunity_type", "vertical"):
        if field in fields and fields[field] is not None:
            value = str(fields[field]).strip() or None
            setattr(opp, field, value)
            changed[field] = value
    if changed:
        opp.updated_by = user.id
        # Title and account also appear in the DeepDive, which the portal owns.
        version = db.get(OpportunityVersion, opp.current_version_id)
        if version and version.deepdive and not version.is_locked:
            version.deepdive.data = _sync_identity(opp, version.deepdive.data)
            version.deepdive.content_sha256 = _hash(version.deepdive.data)
        audit.record(db, "opportunity.updated", actor=user, request=request, entity_type="opportunity",
                     entity_id=opp.id, opportunity_id=opp.id, details=changed)
    return opp


def create_opportunity(db: Session, user: User, number: str, title: str, account: str, request: Request,
                       opportunity_type: str | None = None, vertical: str | None = None) -> Opportunity:
    if user.team_id is None:
        raise unprocessable("Your account is not assigned to a Presales Director's team yet. Ask an Admin to assign you.")
    number = normalize_number(number)
    opp = Opportunity(id=uuid.uuid4(), opportunity_number=number, title=title.strip(), account_name=account.strip(),
                      opportunity_type=(opportunity_type or None), vertical=(vertical or None),
                      status=St.DRAFT, owner_id=user.id, team_id=user.team_id, created_by=user.id, updated_by=user.id)
    db.add(opp)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise conflict(f"Opportunity {number} already exists.", code="duplicate_number")
    opp.manager_id = user.team.manager_id if user.team else None
    opp.director_id = user.team.director_id if user.team else None
    data = _sync_identity(opp, {"accountManager": "", "value": "", "background": ""})
    version = OpportunityVersion(id=uuid.uuid4(), opportunity_id=opp.id, version_number=1, change_notes="Initial version",
                                 created_by=user.id, updated_by=user.id)
    version.deepdive = DeepDiveData(data=data, content_sha256=_hash(data))
    db.add(version)
    db.flush()
    opp.current_version_id = version.id
    db.add(WorkflowHistory(opportunity_id=opp.id, version_id=version.id, action="create", from_status=None,
                           to_status=St.DRAFT, actor_id=user.id))
    audit.record(db, "opportunity.created", actor=user, request=request, entity_type="opportunity", entity_id=opp.id,
                 opportunity_id=opp.id, details={"number": number})
    audit.record(db, "version.created", actor=user, request=request, entity_type="opportunity_version",
                 entity_id=version.id, opportunity_id=opp.id, details={"version": 1})
    return opp


def save_deepdive(db: Session, user: User, opp: Opportunity, version: OpportunityVersion, data: dict,
                  expected_revision: int, request: Request) -> OpportunityVersion:
    if not can_edit_content(user, opp, version):
        if version.is_locked:
            raise conflict("This version is locked. Create a new version to make changes.", code="version_locked")
        raise forbidden("This DeepDive cannot be edited in its current state. Open a new version to continue.")
    if version.revision != expected_revision:
        raise conflict("Someone else saved this DeepDive. Reload to see the latest changes.", code="stale_revision",
                       current_revision=version.revision)
    raw = json.dumps(data, ensure_ascii=False)
    if len(raw.encode()) > get_settings().max_deepdive_bytes:
        raise unprocessable("The DeepDive is too large.")
    data = _sync_identity(opp, data)
    digest = _hash(data)
    if version.deepdive.content_sha256 == digest:
        return version
    version.deepdive.data = data
    version.deepdive.content_sha256 = digest
    version.revision += 1
    version.updated_by = user.id
    opp.updated_by = user.id
    opp.updated_at = datetime.now(UTC)
    audit.record(db, "opportunity.updated", actor=user, request=request, entity_type="opportunity_version",
                 entity_id=version.id, opportunity_id=opp.id,
                 details={"version": version.version_number, "revision": version.revision})
    return version


def remove_opportunity(db: Session, user: User, opp: Opportunity, request: Request) -> str:
    """Drafts that were never submitted are deleted; anything that has been submitted is archived instead.

    Archiving hides the opportunity from every list but keeps the DeepDive, documents, review comments and AI
    results, so a mistake costs nothing. Only an Admin can purge an archived opportunity for good.
    """
    from app.core.enums import RoleKey

    if not can_delete(user, opp):
        raise forbidden("You can delete your own opportunities only.")
    was_submitted = bool(db.scalar(select(func.count()).select_from(OpportunityVersion)
                                   .where(OpportunityVersion.opportunity_id == opp.id,
                                          OpportunityVersion.submitted_at.isnot(None))))
    if was_submitted and user.role_key != RoleKey.ADMIN:
        opp.is_archived = True
        opp.updated_by = user.id
        audit.record(db, "opportunity.archived", actor=user, request=request, entity_type="opportunity",
                     entity_id=opp.id, opportunity_id=opp.id,
                     details={"number": opp.opportunity_number, "status": opp.status})
        return "archived"
    purge_opportunity(db, user, opp, request)
    return "deleted"


def archive_opportunity(db: Session, user: User, opp: Opportunity, request: Request) -> None:
    """Nothing is deleted: the DeepDive, documents, versions, risks, support needs and AI history all remain."""
    if not can_delete(user, opp):
        raise forbidden("You can archive your own opportunities only.")
    opp.is_archived = True
    opp.updated_by = user.id
    audit.record(db, "opportunity.archived", actor=user, request=request, entity_type="opportunity",
                 entity_id=opp.id, opportunity_id=opp.id,
                 details={"number": opp.opportunity_number, "status": opp.status})


def restore_opportunity(db: Session, user: User, opp: Opportunity, request: Request) -> None:
    if not can_delete(user, opp):
        raise forbidden("You cannot restore this opportunity.")
    opp.is_archived = False
    opp.updated_by = user.id
    audit.record(db, "opportunity.restored", actor=user, request=request, entity_type="opportunity",
                 entity_id=opp.id, opportunity_id=opp.id, details={"number": opp.opportunity_number})


def purge_opportunity(db: Session, user: User, opp: Opportunity, request: Request) -> None:
    """Permanent delete, with the stored document files removed too. The audit entry survives."""
    from app.models import OpportunityDocument
    from app.services.storage import get_storage

    if not can_delete(user, opp):
        raise forbidden("You can delete your own opportunities only.")
    # Lets this transaction remove frozen records. Audit entries are never covered by it.
    db.execute(text("SET LOCAL portal.purge = 'on'"))
    storage = get_storage()
    seen: set[str] = set()
    for document in db.execute(select(OpportunityDocument).where(OpportunityDocument.opportunity_id == opp.id)).scalars():
        if document.storage_key in seen:      # versions share the stored bytes
            continue
        seen.add(document.storage_key)
        try:
            storage.delete(document.storage_key)
        except Exception:      # a missing file must not block the delete
            pass
    audit.record(db, "opportunity.deleted", actor=user, request=request, entity_type="opportunity", entity_id=opp.id,
                 details={"number": opp.opportunity_number, "title": opp.title, "status": opp.status,
                          "archived": opp.is_archived})
    opp.current_version_id = None
    db.flush()
    db.delete(opp)


def create_version(db: Session, user: User, opp: Opportunity, change_notes: str, request: Request) -> OpportunityVersion:
    if not can_create_version(user, opp):
        raise forbidden("A new version can be opened by the opportunity owner, the Portfolio Presales Manager "
                        "or the Portfolio Presales Director.")
    if not change_notes.strip():
        raise unprocessable("Describe what changes in this version.")
    current = db.get(OpportunityVersion, opp.current_version_id)
    now = datetime.now(UTC)
    if not current.is_locked:  # checkpoint the working copy so it can never change afterwards
        current.is_locked, current.locked_at = True, now
    next_number = (db.scalar(select(func.max(OpportunityVersion.version_number))
                             .where(OpportunityVersion.opportunity_id == opp.id)) or 0) + 1
    data = _sync_identity(opp, json.loads(json.dumps(current.deepdive.data)))   # full copy of the previous version
    new = OpportunityVersion(id=uuid.uuid4(), opportunity_id=opp.id, version_number=next_number,
                             based_on_version_id=current.id, change_notes=change_notes.strip()[:2000],
                             created_by=user.id, updated_by=user.id)
    new.deepdive = DeepDiveData(data=data, content_sha256=_hash(data))
    db.add(new)
    db.flush()
    from app.services.documents import carry_forward

    carried = carry_forward(db, current.id, new.id, opp.id)   # v2 starts with v1's documents
    opp.current_version_id = new.id
    opp.updated_by = user.id
    reopened = None
    if opp.status not in (St.DRAFT, St.CHANGES_REQUESTED):
        # The reviewed version stays exactly as it was; work continues on the new one.
        reopened, opp.status = opp.status, St.DRAFT
        db.add(WorkflowHistory(opportunity_id=opp.id, version_id=new.id, action="new_version", from_status=reopened,
                               to_status=St.DRAFT, actor_id=user.id,
                               comment=f"Version {next_number} opened by {user.full_name}"))
        notify(db, [opp.owner_id, opp.manager_id, opp.director_id], "opportunity.new_version",
               f"New version opened: {opp.title}",
               body=f"{opp.opportunity_number} · v{next_number} — {change_notes.strip()[:200]}", opportunity_id=opp.id)
    audit.record(db, "version.created", actor=user, request=request, entity_type="opportunity_version", entity_id=new.id,
                 opportunity_id=opp.id, details={"version": next_number, "based_on": current.version_number,
                                                 "reopened_from": reopened, "documents_carried": carried})
    return new
