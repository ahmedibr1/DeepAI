import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { OpportunityListItem, Page, Reference } from "../api/types";
import { opportunitiesLabel, PERM, useAuth } from "../auth/AuthContext";
import { OpportunityCards } from "../components/OpportunityTable";
import { Icon } from "../components/Icon";
import { ErrorAlert, PageHeader } from "../components/ui";
import { useAsync } from "../lib/useAsync";
import { SheetImport } from "../components/SheetImport";

const FILTER_KEYS = ["q", "account", "number", "owner_id", "director_id", "ai_readiness", "updated_from",
  "updated_to", "critical", "attention", "open_comments", "archived", "assigned_to_me", "active"] as const;

export function OpportunitiesPage() {
  const { me, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") ?? 1);
  const statuses = params.getAll("status");
  const key = params.toString();

  const ref = useAsync(() => api.get<Reference>("/meta/reference"), []);
  const list = useAsync(() => {
    const query: Record<string, string | string[] | number> = { page, page_size: 25 };
    FILTER_KEYS.forEach((k) => { const v = params.get(k); if (v) query[k] = v; });
    if (statuses.length) query.status = statuses;
    return api.get<Page<OpportunityListItem>>("/opportunities", query);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    next.delete("page");
    setParams(next, { replace: true });
  };
  const setStatus = (v: string) => {
    const next = new URLSearchParams(params);
    next.delete("status");
    if (v) v.split(",").forEach((s) => next.append("status", s));
    next.delete("page");
    setParams(next, { replace: true });
  };
  const pages = useMemo(() => Math.max(1, Math.ceil((list.data?.total ?? 0) / 25)), [list.data]);
  const showDirectorFilter = can(PERM.OPP_VIEW_ALL);
  const showOwnerFilter = can(PERM.OPP_VIEW_ALL) || can(PERM.OPP_VIEW_TEAM);
  const attention = params.get("attention") === "1";
  const activeOnly = params.get("active") === "1";

  return (
    <main className="content">
      <PageHeader title={params.get("active") === "1" ? "Active opportunities" : opportunitiesLabel(me)} lede={list.data ? `${list.data.total} opportunit${list.data.total === 1 ? "y" : "ies"}` : undefined}
        actions={can(PERM.OPP_CREATE) && <>
          <SheetImport onDone={() => void list.reload()} />
          <Link className="btn primary" to="/opportunities/new">Create opportunity</Link>
        </>} />
      <ErrorAlert error={list.error ?? ref.error} />
      {activeOnly && <div className="alert info" style={{ marginBottom: 14 }}>
        Everything the team is still working on. An opportunity leaves this list when management closes it,
        and stays visible under {opportunitiesLabel(me)}.
      </div>}
      {attention && <div className="alert info" style={{ marginBottom: 14 }}>
        Showing opportunities with high-priority support needs or high-impact risks.{" "}
        <Link to="/dashboard">See the details on the dashboard</Link>.
      </div>}
      <label className="opp-search">
        <Icon name="search" />
        <input type="search" defaultValue={params.get("q") ?? ""} id="f-q" aria-label="Search by OPP number"
          placeholder="Search by OPP number (e.g. 165128), opportunity name or account…" onChange={(e) => update("q", e.target.value)} />
      </label>
      <section className="card">
        <div className="filters" role="search">
          <div className="field"><label htmlFor="f-account">Account</label>
            <input id="f-account" defaultValue={params.get("account") ?? ""} onChange={(e) => update("account", e.target.value)} /></div>
          <div className="field"><label htmlFor="f-number">Opportunity number</label>
            <input id="f-number" defaultValue={params.get("number") ?? ""} onChange={(e) => update("number", e.target.value)} /></div>
          <div className="field"><label htmlFor="f-status">Status</label>
            <select id="f-status" value={statuses.join(",")} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {statuses.length > 1 && <option value={statuses.join(",")}>Selected ({statuses.length})</option>}
              {ref.data?.statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select></div>
          {showOwnerFilter && (
            <div className="field"><label htmlFor="f-owner">Presales Lead</label>
              <select id="f-owner" value={params.get("owner_id") ?? ""} onChange={(e) => update("owner_id", e.target.value)}>
                <option value="">All Presales Leads</option>
                {ref.data?.owners.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select></div>
          )}
          {showDirectorFilter && (
            <div className="field"><label htmlFor="f-director">Director</label>
              <select id="f-director" value={params.get("director_id") ?? ""} onChange={(e) => update("director_id", e.target.value)}>
                <option value="">All directors</option>
                {ref.data?.directors.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select></div>
          )}
          <div className="field"><label htmlFor="f-archived">Show</label>
            <select id="f-archived" value={params.get("archived") ?? ""} onChange={(e) => update("archived", e.target.value)}>
              <option value="">Active</option><option value="1">Archived</option>
            </select></div>
          <div className="field"><label htmlFor="f-ai">AI readiness</label>
            <select id="f-ai" value={params.get("ai_readiness") ?? ""} onChange={(e) => update("ai_readiness", e.target.value)}>
              <option value="">Any</option><option value="ready">Ready</option><option value="ready_with_actions">Ready with actions</option>
              <option value="not_ready">Not ready</option><option value="none">Not analysed</option>
            </select></div>
          <div className="field"><label htmlFor="f-from">Updated from</label>
            <input id="f-from" type="date" value={params.get("updated_from") ?? ""} onChange={(e) => update("updated_from", e.target.value)} /></div>
          <div className="field"><label htmlFor="f-to">Updated to</label>
            <input id="f-to" type="date" value={params.get("updated_to") ?? ""} onChange={(e) => update("updated_to", e.target.value)} /></div>
        </div>
        {list.loading && !list.data ? <p className="muted card-pad">Loading…</p> : (
          <OpportunityCards onChanged={() => void list.reload()} rows={list.data?.items ?? []}
            empty={params.toString() ? "No opportunities match these filters." : "No opportunities yet."} />
        )}
        {pages > 1 && (
          <div className="pager">
            <button className="btn ghost small" disabled={page <= 1} onClick={() => update("page", String(page - 1))}>Previous</button>
            <span>Page {page} of {pages}</span>
            <button className="btn ghost small" disabled={page >= pages} onClick={() => update("page", String(page + 1))}>Next</button>
          </div>
        )}
      </section>
    </main>
  );
}
