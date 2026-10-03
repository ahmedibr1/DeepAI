import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { PERM, useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { AuditPage } from "./pages/admin/AuditPage";
import { UsersPage } from "./pages/admin/UsersPage";
import { PortfoliosPage } from "./pages/admin/PortfoliosPage";
import { AppearancePage } from "./pages/admin/AppearancePage";
import { AiPromptPage } from "./pages/AiPromptPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { CreateOpportunityPage } from "./pages/CreateOpportunityPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { OpportunitiesPage } from "./pages/OpportunitiesPage";
import { OpportunityPage } from "./pages/OpportunityPage";
import { AiRecommendationsPage, ReviewsPage } from "./pages/StagePages";

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="empty">Loading…</div>;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (me.must_change_password && location.pathname !== "/change-password") return <Navigate to="/change-password" replace />;
  return <>{children}</>;
}

function RequirePerm({ any, children }: { any: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!any.some(can)) {
    return <main className="content"><div className="card card-pad"><b>You don’t have access to this page.</b><p className="muted">Ask an Admin if you need it.</p></div></main>;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<RequireAuth><ChangePasswordPage /></RequireAuth>} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/opportunities" element={<OpportunitiesPage />} />
        <Route path="/opportunities/new" element={<RequirePerm any={[PERM.OPP_CREATE]}><CreateOpportunityPage /></RequirePerm>} />
        <Route path="/opportunities/:id/*" element={<OpportunityPage />} />
        <Route path="/reviews" element={<RequirePerm any={[PERM.REVIEW_DECIDE, PERM.DASHBOARD_EXECUTIVE]}><ReviewsPage /></RequirePerm>} />
        <Route path="/ai-recommendations" element={<RequirePerm any={[PERM.AI_VIEW]}><AiRecommendationsPage /></RequirePerm>} />
        <Route path="/admin/users" element={<RequirePerm any={[PERM.USER_MANAGE]}><UsersPage /></RequirePerm>} />
        <Route path="/admin/portfolios" element={<RequirePerm any={[PERM.TEAM_MANAGE]}><PortfoliosPage /></RequirePerm>} />
        <Route path="/admin/teams" element={<RequirePerm any={[PERM.TEAM_MANAGE]}><PortfoliosPage /></RequirePerm>} />
        <Route path="/admin/appearance" element={<RequirePerm any={[PERM.USER_MANAGE]}><AppearancePage /></RequirePerm>} />
        <Route path="/ai-prompt" element={<RequirePerm any={[PERM.AI_VIEW]}><AiPromptPage /></RequirePerm>} />
        <Route path="/admin/audit" element={<RequirePerm any={[PERM.AUDIT_VIEW]}><AuditPage /></RequirePerm>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
