import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Me } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ErrorAlert, useToast } from "../components/ui";

export function ChangePasswordPage() {
  const { me, setMe, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) { setError({ message: "The new passwords don’t match." }); return; }
    try {
      const updated = await api.post<Me>("/auth/change-password", { current_password: current, new_password: next });
      setMe(updated);
      toast("Password changed.");
      navigate("/dashboard", { replace: true });
    } catch (err) { setError(err); }
  };

  return (
    <div className="login">
      <section className="hero" aria-hidden="true"><b>solutions by stc</b><div className="kick">PRESALES PORTAL</div><h1>Welcome</h1>
        <p>{me?.full_name}, choose your own password before you continue.</p></section>
      <section className="panel">
        <form onSubmit={submit}>
          <h2>Set your password</h2>
          <p className="muted" style={{ margin: 0 }}>At least 12 characters, with letters and numbers.</p>
          <ErrorAlert error={error} />
          <div className="field"><label htmlFor="cur">Current (temporary) password</label>
            <input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
          <div className="field"><label htmlFor="new">New password</label>
            <input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
          <div className="field"><label htmlFor="confirm">Confirm new password</label>
            <input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          <button className="btn primary" type="submit" disabled={!current || !next || !confirm}>Save password</button>
          <button className="btn ghost" type="button" onClick={() => void logout()}>Sign out</button>
        </form>
      </section>
    </div>
  );
}
