import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAsync } from "../lib/useAsync";
import type { OpportunityDetail } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ErrorAlert, PageHeader } from "../components/ui";

export function CreateOpportunityPage() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");
  const [account, setAccount] = useState("");
  const [type, setType] = useState("");
  const [vertical, setVertical] = useState("");
  const verticals = useAsync(() => api.get<{ id: string; name: string }[]>("/admin/verticals"), []);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const opp = await api.post<OpportunityDetail>("/opportunities", {
        opportunity_number: number, title, account_name: account,
        opportunity_type: type || null, vertical: vertical || null,
      });
      navigate(`/opportunities/${opp.id}/deepdive`, { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <main className="content">
      <PageHeader kicker="Stage 1 · DeepDive" title="Create opportunity"
        lede="Start with the identifiers. You’ll fill in the full DeepDive next. Everything is saved as version 1 of this opportunity." />
      <form className="card card-pad" style={{ maxWidth: 760 }} onSubmit={submit}>
        {!me?.team && <div className="alert info" style={{ marginBottom: 14 }}>Your account isn’t assigned to a Presales Director’s team yet, so you can’t create opportunities. Ask an Admin to assign you.</div>}
        <ErrorAlert error={error} />
        <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="num">Opportunity number <span style={{ color: "var(--coral)" }}>*</span></label>
            <input id="num" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="OP-2026-159388" required maxLength={64} />
            <span className="hint">Unique across the portal. It can’t be changed later.</span>
          </div>
          <div className="field">
            <label htmlFor="acc">Customer / account <span style={{ color: "var(--coral)" }}>*</span></label>
            <input id="acc" value={account} onChange={(e) => setAccount(e.target.value)} required maxLength={200} />
          </div>
          <div className="field span">
            <label htmlFor="title">Opportunity name <span style={{ color: "var(--coral)" }}>*</span></label>
            <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} />
          </div>
          <div className="field">
            <label htmlFor="type">Type</label>
            <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Not set</option>
              {["RFP", "RFI", "Non-RFP"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <span className="hint">Shown in the management monitor.</span>
          </div>
          <div className="field">
            <label htmlFor="vertical">Vertical</label>
            <select id="vertical" value={vertical} onChange={(e) => setVertical(e.target.value)}>
              <option value="">Not set</option>
              {(verticals.data ?? []).map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
            </select>
            <span className="hint">Managed on the Portfolios / Verticals page.</span>
          </div>
        </div>
        <p className="muted small">Team: <b>{me?.team?.name ?? "—"}</b>{me?.team?.director ? ` · reviewed by ${me.team.director.full_name}` : ""}</p>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn primary" type="submit" disabled={busy || !me?.team || !number || !title || !account}>{busy ? "Creating…" : "Create and open DeepDive"}</button>
          <button className="btn ghost" type="button" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </main>
  );
}
