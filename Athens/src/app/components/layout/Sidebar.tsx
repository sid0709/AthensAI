import { NavLink, useNavigate } from "react-router";
import { LogOut } from "lucide-react";
import { AppLogo } from "../shared/AppLogo";
import { useAuth } from "@/context/auth-context";
import { useApplier } from "@/context/applier-context";
import { isBetaTier } from "../../lib/beta";
import { isAdminPermission } from "../../lib/admin";
import { pathForView, PATHS } from "../../config/routes";
import { NAV_GROUPS, NAV_ITEMS } from "../../config/navigation";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function Sidebar() {
  const { user, signout } = useAuth();
  const { applier } = useApplier();
  const navigate = useNavigate();
  const account = applier ?? user;
  const beta = isBetaTier(account?.tier);
  const admin = isAdminPermission(applier?.permission ?? user?.permission);

  const handleSignOut = () => {
    signout();
    navigate(PATHS.home, { replace: true });
  };

  return (
    <aside className="athens-sidebar" aria-label="AthensAI navigation">
      <div className="athens-sidebar__brand">
        <NavLink to={PATHS.jobs} className="athens-sidebar__brand-link">
          <AppLogo size={40} />
          <div className="athens-sidebar__brand-copy">
            <span className="athens-sidebar__title">AthensAI</span>
            <span className="athens-sidebar__tagline">AI career command center</span>
          </div>
        </NavLink>
      </div>

      <nav className="athens-sidebar__nav subtle-scroll">
        {NAV_GROUPS.map((g) => (
          <div key={g.label ?? "bottom"}>
            {g.label && <p className="athens-sidebar__eyebrow">{g.label}</p>}
            <div className="athens-sidebar__items">
              {NAV_ITEMS.filter(
                (n) => g.ids.includes(n.id) && (beta || !n.beta) && (admin || !n.admin),
              ).map((item) => (
                <NavLink
                  key={item.id}
                  to={pathForView(item.id)}
                  className="athens-sidebar__item"
                >
                  <item.icon aria-hidden="true" />
                  <span className="athens-sidebar__item-label">{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <footer className="athens-sidebar__footer">
        <span className="athens-sidebar__avatar" aria-hidden="true">
          {user?.name ? initials(user.name) : "?"}
        </span>
        <span className="athens-sidebar__user">
          <strong>{user?.name ?? "Signed out"}</strong>
          <span>Job seeker</span>
        </span>
        <button
          type="button"
          className="athens-sidebar__logout"
          aria-label="Log out"
          title="Sign out"
          onClick={handleSignOut}
        >
          <LogOut size={18} aria-hidden="true" />
        </button>
      </footer>
    </aside>
  );
}
