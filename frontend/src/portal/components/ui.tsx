import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Status } from "../api/types";
import { READINESS_LABEL } from "../lib/format";

export function StatusBadge({ status, label }: { status: Status; label: string }) {
  return <span className={`badge st-${status}`}>{label}</span>;
}

export function ReadinessBadge({ value }: { value: string | null }) {
  if (!value) return <span className="muted small">Not analysed</span>;
  return <span className={`badge rd-${value}`}>{READINESS_LABEL[value] ?? value}</span>;
}

export function PageHeader({ kicker, title, lede, actions }: { kicker?: string; title: string; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {kicker && <p className="kicker">{kicker}</p>}
        <h1>{title}</h1>
        {lede && <p>{lede}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children}</div>;
}

export function Modal({ title, children, onClose, footer, wide }: { title: string; children: ReactNode; onClose: () => void; footer: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("textarea, input, select, button")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <h2 id="modal-title">{title}</h2>
        {children}
        <div className="row">{footer}</div>
      </div>
    </div>
  );
}

type Toast = { id: number; text: string; tone?: "error" };
const ToastContext = createContext<(text: string, tone?: "error") => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone?: "error") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone ?? ""}`}>{t.text}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as { message?: string; detail?: { missing?: string[]; problems?: string[] } };
  const list = e.detail?.missing ?? e.detail?.problems;
  return (
    <div className="alert error" role="alert">
      {e.message ?? "Something went wrong."}
      {list && list.length > 0 && <ul>{list.slice(0, 12).map((m) => <li key={m}>{m}</li>)}{list.length > 12 && <li>…and {list.length - 12} more</li>}</ul>}
    </div>
  );
}
