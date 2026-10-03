import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ErrorAlert } from "../components/ui";

export function LoginPage() {
  const { me, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? "/dashboard";

  if (me) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(username.trim(), password);
      navigate(user.must_change_password ? "/change-password" : from, { replace: true });
    } catch (err) {
      setError(err);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section className="hero" aria-hidden="true">
        <b>solutions by stc</b>
        <div className="kick">PRESALES PORTAL</div>
        <h1>DeepDive</h1>
        <p>Build the DeepDive, get your Director’s review, and prepare every strategic opportunity for AI-assisted readiness analysis.</p>
      </section>
      <section className="panel">
        <form onSubmit={submit} noValidate>
          <h2>Sign in</h2>
          <p className="muted" style={{ margin: 0 }}>Use the account your portal Admin created for you.</p>
          <ErrorAlert error={error} />
          <div className="field">
            <label htmlFor="username">Username</label>
            <input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn primary" type="submit" disabled={busy || !username || !password}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </section>
    </div>
  );
}
