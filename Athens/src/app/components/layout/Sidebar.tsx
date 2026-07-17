import { NavLink, useNavigate } from "react-router";
import { LogOut } from "lucide-react";
import { AppLogo } from "../shared/AppLogo";
import { useAuth } from "@/context/auth-context";
import { useApplier } from "@/context/applier-context";
import { cn, display } from "../../lib/utils";
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
    navigate(PATHS.signin, { replace: true });
  };

  return (
    <aside
      className="relative z-40 w-60 flex-shrink-0 flex flex-col h-full min-h-0 border-r border-border shadow-sm"
      style={{ background: "var(--sidebar)" }}
    >
      <div className="px-5 py-4 border-b border-border">
        <NavLink to="/" className="flex items-center gap-3">
          <AppLogo size={40} />
          <div className="flex-1 min-w-0">
            <span className="text-base font-bold text-foreground block" style={display}>
              AthensAI
            </span>
            <span className="text-xs text-muted-foreground">AI career command center</span>
          </div>
        </NavLink>
      </div>

      <nav className="flex-1 px-3 py-2 overflow-y-auto subtle-scroll space-y-5">
        {NAV_GROUPS.map((g) => (
          <div key={g.label ?? "bottom"}>
            {g.label && (
              <p className="px-3 mb-2 text-xs font-bold tracking-wider text-muted-foreground/60 uppercase">
                {g.label}
              </p>
            )}
            <div className="space-y-1">
              {NAV_ITEMS.filter(
                (n) => g.ids.includes(n.id) && (beta || !n.beta) && (admin || !n.admin),
              ).map((item) => (
                <NavLink
                  key={item.id}
                  to={pathForView(item.id)}
                  end={item.id === "dashboard"}
                  className={({ isActive }) =>
                    cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-100 min-h-10",
                      isActive
                        ? "bg-primary/10 text-primary font-bold"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary font-semibold",
                    )
                  }
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.comingSoon && (
                    <span className="px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold leading-none whitespace-nowrap">
                      Coming Soon
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-secondary transition-colors group">
          <div className="w-10 h-10 rounded-full bg-violet-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
            {user?.name ? initials(user.name) : "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground truncate">{user?.name ?? "Signed out"}</p>
            <p className="text-xs text-muted-foreground truncate">Job seeker</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-background opacity-0 group-hover:opacity-100 transition-opacity"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
