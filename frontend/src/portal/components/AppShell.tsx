import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { NotificationItem } from "../api/types";
import { opportunitiesLabel, PERM, useAuth } from "../auth/AuthContext";
import { timeAgo } from "../lib/format";
import { readAppearance } from "../pages/admin/AppearancePage";
import { BrandMark } from "./BrandMark";
import { Icon } from "./Icon";

function NavItem({ to, icon, label, soon, end, match }: {
  to: string; icon: string; label: string; soon?: string; end?: boolean;
  /** Same path, different query: decide the highlight from the query instead of the path. */
  match?: (search: URLSearchParams) => boolean;
}) {
  const location = useLocation();
  return (
    <NavLink to={to} end={end}
      className={({ isActive }) => {
        const active = match
          ? isActive && match(new URLSearchParams(location.search))
          : isActive;
        return `nav-link${active ? " active" : ""}`;
      }}>
      <Icon name={icon} /> {label}{soon && <span className="soon">{soon}</span>}
    </NavLink>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const unread = items.filter((n) => !n.read_at).length;

  const load = () => api.get<NotificationItem[]>("/notifications", { limit: 20 }).then(setItems).catch(() => undefined);
  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const openItem = async (n: NotificationItem) => {
    if (!n.read_at) await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    setOpen(false);
    void load();
    if (n.opportunity_id) navigate(`/opportunities/${n.opportunity_id}`);
  };

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" className="icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open}
        onClick={() => { setOpen(!open); if (!open) void load(); }}>
        <Icon name="bell" />
        {unread > 0 && <span className="dot">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="popover" role="region" aria-label="Notifications">
          <header>Notifications
            {unread > 0 && <button type="button" onClick={() => api.post("/notifications/read-all").then(load)}>Mark all read</button>}
          </header>
          {items.length === 0 ? <div className="empty small">No notifications yet.</div> : items.map((n) => (
            <a key={n.id} href="#" className={`notif${n.read_at ? "" : " unread"}`} onClick={(e) => { e.preventDefault(); void openItem(n); }}>
              <b>{n.title}</b>
              {n.body && <span>{n.body}</span>}
              <span>{timeAgo(n.created_at)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const { me, can, logout } = useAuth();
  const [userOpen, setUserOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);   // phones: the sidebar slides in over the content
  const location = useLocation();
  const section = location.pathname.split("/")[1] || "dashboard";
  const activeOnly = new URLSearchParams(location.search).get("active") === "1";
  const crumbs: Record<string, string> = {
    dashboard: "Dashboard", opportunities: activeOnly ? "Active opportunities" : opportunitiesLabel(me), reviews: "Reviews",
    "ai-recommendations": "AI Recommendations", admin: "Administration",
  };

  return (
    <div className={`shell${navOpen ? " nav-open" : ""}`}>
      {navOpen && <button type="button" className="nav-scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} />}
      <aside className="sidenav" onClick={() => setNavOpen(false)}>
        <div className="brand"><BrandMark size={34} onDark /><div><b>{readAppearance().product}</b><span>solutions by stc</span></div></div>
        <nav aria-label="Main">
          <NavItem to="/dashboard" icon="dashboard" label="Dashboard" />
          <div className="nav-group">Opportunities</div>
          <NavItem to="/opportunities?active=1" icon="checkCircle" label="Active Opportunities" end
            match={(q) => q.get("archived") !== "1"} />
          <NavItem to="/opportunities?archived=1" icon="archive" label="Archived Opportunities" end
            match={(q) => q.get("archived") === "1"} />
          {can(PERM.OPP_CREATE) && <NavItem to="/opportunities/new" icon="plus" label="Create opportunity" />}
          {(can(PERM.AI_VIEW) || can(PERM.REVIEW_DECIDE) || can(PERM.DASHBOARD_EXECUTIVE)) && (
            <div className="nav-group">Insights</div>
          )}
          {can(PERM.AI_VIEW) && <NavItem to="/ai-recommendations" icon="spark" label="AI Recommendations" />}
          {can(PERM.AI_VIEW) && <NavItem to="/ai-prompt" icon="doc" label="AI Configuration" />}
          {(can(PERM.USER_MANAGE) || can(PERM.AUDIT_VIEW)) && (
            <>
              <div className="nav-group">Administration</div>
              {can(PERM.USER_MANAGE) && <NavItem to="/admin/users" icon="users" label="Users" />}
              {can(PERM.TEAM_MANAGE) && <NavItem to="/admin/portfolios" icon="team" label="Portfolios / Verticals" />}
              {can(PERM.AUDIT_VIEW) && <NavItem to="/admin/audit" icon="shield" label="Audit log" />}
            </>
          )}
          {can(PERM.USER_MANAGE) && (
            <>
              <div className="nav-group">UI Customization</div>
              <NavItem to="/admin/appearance" icon="palette" label="UI Customization" />
            </>
          )}
        </nav>
        <div className="me"><b>{me?.full_name}</b><span>{me?.role_label}{me?.team ? ` · ${me.team.name}` : ""}</span></div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button type="button" className="menu-btn" aria-label="Menu" aria-expanded={navOpen}
            onClick={() => setNavOpen((v) => !v)}>
            <span /><span /><span />
          </button>
          <div className="crumbs"><Link to="/dashboard" style={{ color: "inherit", textDecoration: "none" }}>Portal</Link> / {crumbs[section] ?? ""}</div>
          <Notifications />
          <div className="user-menu">
            <button type="button" className="user-chip" aria-expanded={userOpen} aria-haspopup="menu"
              onClick={() => setUserOpen((v) => !v)}>
              <span className="avatar" aria-hidden="true">{(me?.full_name ?? "?").trim().charAt(0).toUpperCase()}</span>
              <span className="who">{me?.full_name?.split(" ")[0]}</span>
              <span className="caret-down" aria-hidden="true"><Icon name="chevronDown" /></span>
            </button>
            {userOpen && (
              <div className="user-dropdown" role="menu">
                <div className="who-full">
                  <b>{me?.full_name}</b>
                  <span className="muted small">{me?.role_label}</span>
                </div>
                <button type="button" role="menuitem" onClick={() => void logout()}><Icon name="logout" /> Sign out</button>
              </div>
            )}
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
