import uuid
from datetime import date, datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, EmailStr, Field

T = TypeVar("T")


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class UserRef(ORM):
    id: uuid.UUID
    username: str
    full_name: str


class TeamOut(ORM):
    id: uuid.UUID
    name: str
    is_active: bool
    director: UserRef | None = None
    manager: UserRef | None = None
    member_count: int = 0


class MeOut(BaseModel):
    id: uuid.UUID
    username: str
    full_name: str
    email: str | None
    role: str
    role_label: str
    team: TeamOut | None
    permissions: list[str]
    must_change_password: bool


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class UserOut(ORM):
    id: uuid.UUID
    username: str
    full_name: str
    email: str | None
    role: str
    team_id: uuid.UUID | None
    team_name: str | None
    is_active: bool
    must_change_password: bool
    last_login_at: datetime | None
    locked: bool
    created_at: datetime


class UserCreateIn(BaseModel):
    username: str = Field(min_length=3, max_length=80, pattern=r"^[A-Za-z0-9._\-@]+$")
    full_name: str = Field(min_length=1, max_length=160)
    email: EmailStr | None = None
    role: str
    team_id: uuid.UUID | None = None
    temporary_password: str = Field(min_length=1, max_length=256)


class UserUpdateIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=160)
    email: EmailStr | None = None
    role: str | None = None
    team_id: uuid.UUID | None = None
    clear_team: bool = False
    is_active: bool | None = None
    unlock: bool = False


class ResetPasswordIn(BaseModel):
    temporary_password: str = Field(min_length=1, max_length=256)


class TeamCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    director_id: uuid.UUID | None = None
    manager_id: uuid.UUID | None = None


class TeamUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    director_id: uuid.UUID | None = None
    manager_id: uuid.UUID | None = None
    clear_director: bool = False
    clear_manager: bool = False
    is_active: bool | None = None


class OpportunityCreateIn(BaseModel):
    opportunity_number: str = Field(min_length=3, max_length=64)
    title: str = Field(min_length=1, max_length=300)
    account_name: str = Field(min_length=1, max_length=200)
    opportunity_type: str | None = Field(default=None, max_length=60)
    vertical: str | None = Field(default=None, max_length=60)


class OpportunityUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    account_name: str | None = Field(default=None, min_length=1, max_length=200)
    opportunity_type: str | None = Field(default=None, max_length=60)
    vertical: str | None = Field(default=None, max_length=60)


class VersionSummary(ORM):
    id: uuid.UUID
    version_number: int
    change_notes: str | None
    is_locked: bool
    revision: int
    created_at: datetime
    updated_at: datetime
    submitted_at: datetime | None
    locked_at: datetime | None
    created_by: UserRef
    updated_by: UserRef
    is_current: bool = False


class VersionDetail(VersionSummary):
    data: dict[str, Any]


class OpportunityListItem(BaseModel):
    id: uuid.UUID
    opportunity_number: str
    title: str
    account_name: str
    opportunity_type: str | None = None
    vertical: str | None = None
    status: str
    status_label: str
    owner: UserRef
    team_name: str | None
    manager: UserRef | None
    director: UserRef | None
    ai_status: str
    ai_status_label: str
    current_version: int | None
    ai_readiness: str | None
    has_critical_findings: bool
    created_at: datetime
    updated_at: datetime


class OpportunityDetail(OpportunityListItem):
    current_version_id: uuid.UUID | None
    can_edit: bool
    can_create_version: bool
    can_view_ai: bool
    can_delete: bool
    is_archived: bool
    can_manage_documents: bool
    document_count: int
    open_comments: int
    actions: list[dict]


class DeepDiveSaveIn(BaseModel):
    data: dict[str, Any]
    revision: int


class NewVersionIn(BaseModel):
    change_notes: str = Field(min_length=1, max_length=2000)


class TransitionIn(BaseModel):
    action: str
    comment: str | None = Field(default=None, max_length=5000)
    expected_version_id: uuid.UUID | None = None


class HistoryItem(BaseModel):
    id: int
    action: str
    from_status: str | None
    to_status: str
    from_label: str | None
    to_label: str
    actor: UserRef | None
    comment: str | None
    version_number: int | None
    created_at: datetime


class NotificationOut(ORM):
    id: uuid.UUID
    type: str
    title: str
    body: str | None
    opportunity_id: uuid.UUID | None
    read_at: datetime | None
    created_at: datetime


class AuditOut(ORM):
    id: int
    occurred_at: datetime
    actor_username: str | None
    action: str
    outcome: str
    entity_type: str | None
    entity_id: str | None
    opportunity_id: uuid.UUID | None
    ip_address: Any | None
    details: dict | None


class DateRange(BaseModel):
    date_from: date | None = None
    date_to: date | None = None


class DocumentOut(ORM):
    id: uuid.UUID
    logical_document_id: uuid.UUID
    doc_version: int
    category: str
    file_name: str
    file_extension: str
    mime_type: str
    size_bytes: int
    sha256: str
    scan_status: str
    extraction_status: str
    uploaded_by: UserRef
    uploaded_at: datetime
    version_number: int | None = None
    is_latest: bool = True
    superseded_count: int = 0


class CommentIn(BaseModel):
    comment_type: str = "general"
    section: str | None = Field(default=None, max_length=60)
    body: str = Field(min_length=1, max_length=5000)
    priority: str | None = None
    owner_name: str | None = Field(default=None, max_length=160)
    owner_user_id: uuid.UUID | None = None
    due_date: date | None = None


class CommentPatch(BaseModel):
    body: str | None = Field(default=None, max_length=5000)
    section: str | None = Field(default=None, max_length=60)
    priority: str | None = None
    owner_name: str | None = Field(default=None, max_length=160)
    due_date: date | None = None
    status: str | None = None


class CommentOut(ORM):
    id: uuid.UUID
    version_id: uuid.UUID
    version_number: int | None = None
    comment_type: str
    section: str | None
    body: str
    priority: str | None
    owner_name: str | None
    due_date: date | None
    status: str
    created_by: UserRef
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None


class ReviewOut(BaseModel):
    id: uuid.UUID
    version_id: uuid.UUID
    version_number: int | None
    reviewer: UserRef
    decision: str | None
    summary: str | None
    decided_at: datetime | None
    created_at: datetime


class ReviewBundle(BaseModel):
    can_comment: bool
    current_version_id: uuid.UUID | None
    reviews: list[ReviewOut]
    comments: list[CommentOut]
    counts: dict[str, int]


class DocumentOut(ORM):
    id: uuid.UUID
    file_name: str
    file_extension: str
    mime_type: str
    size_bytes: int
    category: str
    doc_version: int
    sha256: str
    uploaded_at: datetime
    uploaded_by: UserRef
    version_number: int | None
    can_delete: bool


class CommentCreateIn(BaseModel):
    comment_type: str = "general"
    section: str | None = Field(default=None, max_length=60)
    body: str = Field(min_length=1, max_length=5000)
    priority: str | None = None
    owner_name: str | None = Field(default=None, max_length=160)
    due_date: date | None = None
    version_id: uuid.UUID | None = None


class CommentUpdateIn(BaseModel):
    body: str | None = Field(default=None, min_length=1, max_length=5000)
    section: str | None = Field(default=None, max_length=60)
    priority: str | None = None
    owner_name: str | None = Field(default=None, max_length=160)
    due_date: date | None = None
    status: str | None = None


class CommentOut(ORM):
    id: uuid.UUID
    comment_type: str
    section: str | None
    body: str
    priority: str | None
    owner_name: str | None
    due_date: date | None
    status: str
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None
    created_by: UserRef
    created_by_role: str = ""
    version_id: uuid.UUID
    version_number: int | None
    can_manage: bool


class ReviewOut(BaseModel):
    can_comment: bool
    current_version_id: uuid.UUID | None
    version_id: uuid.UUID | None = None
    open_count: int
    decisions: list[dict]
    comments: list[CommentOut]
