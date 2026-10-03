# Presales DeepDive Portal

Internal portal for strategic presales opportunities (solutions by stc). The existing **DeepDive Builder** is a module
inside it, and still ships as the offline single-file builder.

- Architecture (12 sections): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Phase 1: authentication, RBAC, users/teams/audit, opportunities, versioning, workflow up to *Ready for AI*,
  notifications, role dashboards, DeepDive Builder integration.
- Update (this release): four business roles (Presales GM, Portfolio Presales Director, Portfolio Presales Manager,
  Presales Account) with portfolios carrying both a Manager and a Director; opportunity data flows into the DeepDive
  (read-only there); the original builder controls (Open, Save draft, Load example, Clear form) are back inside the
  portal; role-specific dashboards with Support Needed / Risks per opportunity; compact opportunity cards; delete with
  confirmation; "Submit to Review"; AI Analytics merged into AI Recommendations.
- Monitor polish (this release): legend dots render as solid colour circles (their own class, no longer clashing with
  the notification badge), legends sit beside the monitor heading, sorting verified across all eight options, narrower
  Opportunity Name with more room for Vertical / Value / both date columns, Vertical read only from its own field, the
  far-right control is the three-dot Edit / Archive menu, and a clearer yellow for 8–12 day and 0–2 attention badges.
- Monitor and administration: Portfolios / Verticals on one Administration page, Attention (Why) column,
  clearly distinct legend and badge colours, a working sort with eight options, a compact monitor header row, rebalanced
  column widths, and a three-dot row menu with Edit and a soft Archive that confirms first and warns when the customer
  submission date is still ahead. Sidebar: Active/Archived Opportunities, AI Recommendations, AI Prompt, Users,
  Portfolios / Verticals, Audit log, UI Customization.
- Mobile and one dashboard style (this release): every role now gets the same dashboard chrome (icon KPI cards, date
  and last-updated, calm panels), and the whole portal works in phone and tablet browsers — the sidebar becomes a menu
  sheet, the monitor collapses to compact rows that expand, tables scroll, and forms stack. Tested at 390 px.
- Management dashboard styling: KPI cards with icons and an accented "Opportunities Needing Attention"
  card, colour legends for submission dates and attention counts, a search row with portfolio and sort controls,
  submission-date pills, three expanded cards (Scope · Risks · Support Needed) and paging with a row count.
- Attention Monitor (management roles only — the Presales Account dashboard is unchanged): the management dashboard lists every active opportunity in one read-only table
  ordered by customer submission date, with type, portfolio, vertical, value, presales-received days, days remaining
  (or Overdue) and a high-item attention count; expanding a row shows the scope, compact stakeholders, and the high
  risks and support needs. Opportunity records gained Type and Vertical. Earlier in this release:
- Versioning: the Overview is master data and is never versioned; DeepDive, Documents, Review & Comments
  and AI Recommendations all belong to the selected version, chosen once above the tabs; a new version copies the
  DeepDive, carries the documents forward, starts a fresh review and becomes current; History lists every version with
  links into each of its tabs. Earlier in this release: an "Active opportunities" view in the left panel, with management closing an opportunity to
  move it out; management can edit an open version and open new versions like the owner; a submitted version is locked
  for everyone until a new version is opened; the example DeepDive now carries High-priority support requests so the
  monitoring view shows Support Needed alongside Risks. Earlier in this release: submitted opportunities are archived rather than deleted (Admin can purge);
  status labels no longer name a role ("Submitted for Review", "In Review"); "Awaiting My Review" counts what is routed
  to that Manager or Director; review decisions and comments record the reviewer's role; a High priority support request
  requires a "needed by" date; the monitoring list shows overdue days, undated items and how long an opportunity has sat.
- Phase 3: the on-premises AI engine — document ingestion with provenance, pgvector hybrid retrieval,
  a PostgreSQL job queue and worker, schema-constrained analysis with grounding checks, immutable runs, and the
  AI Analysis and AI Recommendations screens. Set `PORTAL_LLM_PROVIDER=demo` to exercise the whole flow without a GPU.
- Phase 2: opportunity documents (upload, categories, file versions, audited download) and the
  Director's Review & Comments screen. Malware scanning is not deployed by choice; uploads are validated by
  extension, size and content signature, and `scan_status` is recorded as "skipped".

```
backend/    FastAPI API, SQLAlchemy models, Alembic migration, services, tests (pytest, real PostgreSQL)
frontend/   React + TypeScript portal (src/portal) and the DeepDive Builder module (src/builder)
deploy/     Helm chart for Rancher (web, api, migrations, CloudNativePG, NetworkPolicies, Phase 3 AI components)
e2e/        Playwright end-to-end test across all four roles
docs/       Architecture
```

## Try it without installing anything

```bash
cd frontend && npm ci && npm run build:demo     # dist-demo/Presales_Portal_Phase1_Demo.html
```
One self-contained HTML file: the real portal UI and the real DeepDive Builder, with the API replaced by
`src/demo/mockApi.ts`, which applies the same permissions, scoping, workflow, versioning and validation rules in the
browser (localStorage). Demo accounts are listed in the panel at the bottom right; the password is `Demo2026pass`.
Serve it over http (any static host) rather than opening the file directly, or the browser blocks the embedded builder.
The demo has no real security and is for evaluating the workflow only.

## Quick start

**Docker (any OS, one command):**
```bash
docker compose up --build        # then open http://localhost:8080
```
Sign in as `admin` / `FirstAdmin2026` and set your own password. `docker compose down -v` removes the test data.

**Windows without Docker:**
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\setup-windows.ps1     # database, dependencies, migrations, first admin
.\scripts\start-windows.ps1     # API + web, opens the browser
```

Both are for local testing only: fixed passwords, plain HTTP. Use the Helm chart for anything real.

**AI analysis (RAG) locally.** `docker compose up` also starts the AI worker. Without a GPU it uses the rule-based
demo analyst, so the flow works but nothing is model-generated. With an NVIDIA GPU, run real models with vLLM:
```bash
cp deploy/local/ai-gpu.env.example .env
docker compose --profile gpu up --build     # LLM, embeddings and reranker; first start downloads the weights
```
The pipeline: upload documents → the worker extracts, chunks and embeds them into pgvector → each analysis
retrieves passages (vector + keyword search, optional reranker) → the model answers in JSON → every finding is
checked against the passages it cites. The prompt, temperature, output limit and the Retrieval settings
(top K, minimum score, rerank) on **AI Configuration** are what each run uses, and are recorded on the run.

## Run locally (manual)

Prerequisites: Python 3.12, Node 22, PostgreSQL 16.

```bash
# 1. Database
createuser -P portal            # password: portal (local only)
createdb -O portal portal

# 2. API
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # set PORTAL_JWT_SECRET to a random value
alembic upgrade head
PORTAL_BOOTSTRAP_ADMIN_PASSWORD='ChangeMe-First-2026' python -m scripts.bootstrap_admin
uvicorn app.main:app --reload --port 8000     # API docs at http://localhost:8000/api/docs (non-production)

# 2b. AI worker (separate terminal) — runs ingestion and analysis jobs
python -m app.worker

# 3. Web
cd ../frontend
npm ci
npm run dev                      # http://localhost:5173 (proxies /api to :8000)
```

Sign in as `admin`, set a new password, then:
1. Create a Presales Director and a GM (Users).
2. Create a team led by the Director (Teams).
3. Create Account Presales users in that team.

## Tests

```bash
# Backend: 46 tests (auth, lockout, CSRF, RBAC scoping, full workflow + versioning, DB immutability guards, documents, review comments)
cd backend
# pgvector must exist once per database:  psql -d portal -c "CREATE EXTENSION vector;"
PORTAL_DATABASE_URL=postgresql+psycopg://portal:portal@localhost/portal_test \
PORTAL_JWT_SECRET=$(python -c "import secrets;print(secrets.token_urlsafe(48))") pytest

# Frontend type check and production build
cd frontend && npm run build && npm run build:offline   # dist/ and dist-offline/DeepDive_Builder.html

# End-to-end (API on :8000, `npm run preview` on :4173, fresh database with bootstrap admin)
cd e2e && pip install playwright && playwright install chromium && python portal_e2e.py
```

## Build images and deploy to Rancher

```bash
docker build -t registry.internal.example/presales-portal/api:1.0.0 backend
docker build -t registry.internal.example/presales-portal/web:1.0.0 frontend

# Prerequisites in the cluster: ingress-nginx, cert-manager (internal CA), CloudNativePG operator, Longhorn (or your StorageClass)
kubectl create namespace presales-portal
kubectl -n presales-portal apply -f deploy/k8s/secrets.example.yaml     # after replacing the placeholders (or use Sealed/External Secrets)
helm lint deploy/helm/presales-portal
helm template pp deploy/helm/presales-portal -n presales-portal | less  # review before installing
helm upgrade --install pp deploy/helm/presales-portal -n presales-portal \
  --set ingress.host=deepdive.your-domain --set global.imageRegistry=registry.internal.example
```

Then create the first admin (see the chart NOTES).

AI components (`ai.enabled`) stay off until Phase 3. `deploy/k8s/gpu-time-slicing.yaml` shows GPU sharing for the single RTX PRO 6000.

## Security notes

- Passwords: Argon2id; policy of at least 12 characters with letters and numbers; lockout after 5 failures; forced change of temporary passwords.
- Sessions: JWT in an HttpOnly, SameSite=Strict, Secure cookie. CSRF double-submit header on every write. Disabling a user or resetting their password revokes their sessions.
- Authorisation: permission check on every route plus object scoping on every opportunity query (out-of-scope records return 404).
- Database guards: audit logs append-only; finished AI runs and their findings immutable; DeepDive of a submitted version immutable.
- No secrets in frontend code or values files; no internet egress from the namespace (NetworkPolicies).
