import { useMemo, useState } from "react";
import { api } from "../../api/client";
import type { AdminUser, Me, Reference, RoleKey, Team } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { ErrorAlert, Modal, PageHeader, useToast } from "../../components/ui";
import { fmtDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";

type Draft = { id?: string; username: string; full_name: string; email: string; role: RoleKey; team_id: string; temporary_password: string; is_active: boolean };
const EMPTY: Draft = { username: "", full_name: "", email: "", role: "presales_account", team_id: "", temporary_password: "", is_active: true };

export function UsersPage() {
  const { me } = useAuth();
  const toast = useToast();
  const users = useAsync(() => api.get<AdminUser[]>("/admin/users"), []);
  const teams = useAsync(() => api.get<Team[]>("/admin/teams"), []);
  const ref = useAsync(() => api.get<Reference>("/meta/reference"), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reset, setReset] = useState<AdminUser | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState("");
  const roleLabel = useMemo(() => Object.fromEntries((ref.data?.roles ?? []).map((r) => [r.key, r.label])), [ref.data]);
  const leads = useMemo(() => Object.fromEntries((teams.data ?? []).flatMap((t) =>
    [t.director, t.manager].filter(Boolean).map((u) => [u!.id, t.name]))), [teams.data]);

  const rows = (users.data ?? []).filter((u) => !filter || `${u.full_name} ${u.username} ${u.email ?? ""}`.toLowerCase().includes(filter.toLowerCase()));

  const save = async () => {
    if (!draft) return;
    setError(null);
    try {
      if (draft.id) {
        await api.patch(`/admin/users/${draft.id}`, {
          full_name: draft.full_name, email: draft.email || null, role: draft.role, is_active: draft.is_active,
          team_id: draft.role === "presales_account" && draft.team_id ? draft.team_id : null,
          clear_team: draft.role !== "presales_account" || !draft.team_id,
        });
        toast("User updated.");
      } else {
        await api.post("/admin/users", { ...draft, email: draft.email || null, team_id: draft.role === "presales_account" && draft.team_id ? draft.team_id : null });
        toast("User created. Share the temporary password securely; they must change it at first sign-in.");
      }
      setDraft(null);
      await users.reload();
    } catch (e) { setError(e); }
  };

  const doReset = async () => {
    if (!reset) return;
    setError(null);
    try {
      await api.post(`/admin/users/${reset.id}/reset-password`, { temporary_password: password });
      toast(`Password reset for ${reset.full_name}. Their sessions were signed out.`);
      setReset(null); setPassword("");
      await users.reload();
    } catch (e) { setError(e); }
  };

  const unlock = async (u: AdminUser) => { await api.patch(`/admin/users/${u.id}`, { unlock: true }); toast("Account unlocked."); await users.reload(); };

  return (
    <main className="content">
      <PageHeader kicker="Administration" title="Users" lede="Create accounts, assign roles and place Presales Account users in a portfolio."
        actions={<button className="btn primary" onClick={() => { setError(null); setDraft({ ...EMPTY }); }}>Add user</button>} />
      <ErrorAlert error={users.error} />
      <section className="card">
        <div className="filters"><div className="field"><label htmlFor="uf">Search users</label><input id="uf" value={filter} onChange={(e) => setFilter(e.target.value)} /></div></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Team</th><th>Status</th><th>Last sign-in</th><th><span className="vh">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td><b>{u.full_name}</b><div className="muted small">{u.email}</div></td>
                  <td>{u.username}</td>
                  <td>{roleLabel[u.role] ?? u.role}</td>
                  <td>{u.role === "portfolio_director" ? (leads[u.id] ? <>Leads <b>{leads[u.id]}</b></> : <span className="muted">No team</span>) : u.team_name ?? <span className="muted">—</span>}</td>
                  <td>
                    {!u.is_active ? <span className="badge st-changes_requested">Disabled</span>
                      : u.locked ? <span className="badge st-ready_for_ai">Locked</span>
                      : u.must_change_password ? <span className="badge st-draft">Pending first sign-in</span>
                      : <span className="badge st-completed">Active</span>}
                  </td>
                  <td className="small">{fmtDateTime(u.last_login_at)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn ghost small" onClick={() => { setError(null); setDraft({ id: u.id, username: u.username, full_name: u.full_name, email: u.email ?? "", role: u.role, team_id: u.team_id ?? "", temporary_password: "", is_active: u.is_active }); }}>Edit</button>{" "}
                    <button className="btn ghost small" onClick={() => { setError(null); setReset(u); }}>Reset password</button>{" "}
                    {u.locked && <button className="btn ghost small" onClick={() => void unlock(u)}>Unlock</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {draft && (
        <Modal title={draft.id ? `Edit ${draft.full_name}` : "Add user"} onClose={() => setDraft(null)} footer={<>
          <button className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
          <button className="btn primary" onClick={() => void save()} disabled={!draft.full_name || !draft.username || (!draft.id && !draft.temporary_password)}>{draft.id ? "Save changes" : "Create user"}</button>
        </>}>
          <ErrorAlert error={error} />
          <div className="form-grid" style={{ marginTop: 10 }}>
            <div className="field"><label htmlFor="u-name">Full name</label><input id="u-name" value={draft.full_name} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} /></div>
            <div className="field"><label htmlFor="u-username">Username</label><input id="u-username" value={draft.username} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, username: e.target.value })} /></div>
            <div className="field span"><label htmlFor="u-email">Email</label><input id="u-email" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></div>
            <div className="field"><label htmlFor="u-role">Role</label>
              <select id="u-role" value={draft.role} disabled={draft.id === (me as Me | null)?.id} onChange={(e) => setDraft({ ...draft, role: e.target.value as RoleKey })}>
                {ref.data?.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select></div>
            {draft.role === "presales_account" ? (
              <div className="field"><label htmlFor="u-team">Director’s team</label>
                <select id="u-team" value={draft.team_id} onChange={(e) => setDraft({ ...draft, team_id: e.target.value })}>
                  <option value="">Not assigned</option>
                  {teams.data?.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name}{t.director ? ` — ${t.director.full_name}` : ""}</option>)}
                </select><span className="hint">Needed before they can create opportunities.</span></div>
            ) : <div className="field"><label>Team</label><span className="hint" style={{ paddingTop: 8 }}>{draft.role === "portfolio_director" || draft.role === "portfolio_manager" ? "Assigned to a portfolio on the Portfolios page." : "Not applicable for this role."}</span></div>}
            {!draft.id && (
              <div className="field span"><label htmlFor="u-pass">Temporary password</label>
                <input id="u-pass" type="text" autoComplete="off" value={draft.temporary_password} onChange={(e) => setDraft({ ...draft, temporary_password: e.target.value })} />
                <span className="hint">At least 12 characters with letters and numbers. They must change it at first sign-in.</span></div>
            )}
            {draft.id && (
              <label className="span" style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600, fontSize: 14 }}>
                <input type="checkbox" checked={draft.is_active} disabled={draft.id === me?.id} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} /> Account active
              </label>
            )}
          </div>
        </Modal>
      )}

      {reset && (
        <Modal title={`Reset password for ${reset.full_name}`} onClose={() => setReset(null)} footer={<>
          <button className="btn ghost" onClick={() => setReset(null)}>Cancel</button>
          <button className="btn primary" disabled={!password} onClick={() => void doReset()}>Reset password</button>
        </>}>
          <ErrorAlert error={error} />
          <p className="muted">This signs them out everywhere. They must choose a new password at their next sign-in.</p>
          <div className="field"><label htmlFor="rp">Temporary password</label><input id="rp" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        </Modal>
      )}
    </main>
  );
}
