import type { ReactNode } from "react";
import { AuthHeroPanel } from "./AuthHeroPanel";
import "./auth.css";

type AuthSplitLayoutProps = {
  children: ReactNode;
};

export function AuthSplitLayout({ children }: AuthSplitLayoutProps) {
  return (
    <div className="auth-shell">
      <AuthHeroPanel />
      <main className="auth-console-shell">
        <div className="auth-console">
          <span className="auth-console-corner auth-console-corner-tl" aria-hidden="true" />
          <span className="auth-console-corner auth-console-corner-tr" aria-hidden="true" />
          <span className="auth-console-corner auth-console-corner-bl" aria-hidden="true" />
          <span className="auth-console-corner auth-console-corner-br" aria-hidden="true" />
          <div className="auth-console-content">{children}</div>
          <p className="auth-console-footnote">ENCRYPTED SESSION · ATHENS NETWORK</p>
        </div>
      </main>
    </div>
  );
}
