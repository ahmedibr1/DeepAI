import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type { Me } from "../api/types";

export const PERM = {
  USER_MANAGE: "user.manage", TEAM_MANAGE: "team.manage", AUDIT_VIEW: "audit.view",
  OPP_VIEW_ALL: "opportunity.view_all", OPP_VIEW_TEAM: "opportunity.view_team", OPP_VIEW_OWN: "opportunity.view_own",
  OPP_CREATE: "opportunity.create", OPP_DELETE_OWN: "opportunity.delete_own", OPP_DELETE_ANY: "opportunity.delete_any",
  REVIEW_VIEW: "review.view", REVIEW_DECIDE: "review.decide",
  AI_VIEW: "ai.view", AI_TRIGGER: "ai.trigger", DASHBOARD_EXECUTIVE: "dashboard.executive",
} as const;

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  setMe: (me: Me) => void;
  can: (perm: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Me>("/auth/me").then(setMe).catch(() => setMe(null)).finally(() => setLoading(false));
    const expired = () => setMe(null);
    window.addEventListener("portal:session-expired", expired);
    return () => window.removeEventListener("portal:session-expired", expired);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const user = await api.post<Me>("/auth/login", { username, password });
    setMe(user);
    return user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post("/auth/logout"); } catch (e) { if (!(e instanceof ApiError)) throw e; }
    setMe(null);
  }, []);

  const value = useMemo<AuthState>(() => ({
    me, loading, login, logout, setMe, can: (perm) => !!me?.permissions.includes(perm),
  }), [me, loading, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function opportunitiesLabel(me: Me | null): string {
  if (!me) return "Opportunities";
  if (me.permissions.includes(PERM.OPP_VIEW_ALL)) return "All opportunities";
  if (me.permissions.includes(PERM.OPP_VIEW_TEAM)) return "Team opportunities";
  return "My opportunities";
}
