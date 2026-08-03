import { useEffect, useRef, type ReactNode } from "react";
import { AuthHeroPanel } from "./AuthHeroPanel";
import { useAuthExperience } from "../experience/AuthExperienceContext";
import "./auth.css";

type AuthSplitLayoutProps = {
  children: ReactNode;
};

export function AuthSplitLayout({ children }: AuthSplitLayoutProps) {
  const { introActive } = useAuthExperience();
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    shellRef.current?.toggleAttribute("inert", introActive);
  }, [introActive]);

  return (
    <div
      ref={shellRef}
      className={`auth-shell ${introActive ? "auth-intro-blocked" : "auth-intro-ready"}`}
      aria-hidden={introActive || undefined}
    >
      <AuthHeroPanel />
      <main className="auth-console-shell" aria-hidden={introActive || undefined}>
        <div className="auth-console">
          <span className="auth-console-corner auth-console-corner-tl" aria-hidden="true" />
          <span className="auth-console-corner auth-console-corner-tr" aria-hidden="true" />
          <span className="auth-console-corner auth-console-corner-bl" aria-hidden="true" />
          <span className="auth-console-corner auth-console-corner-br" aria-hidden="true" />
          <div className="auth-console-content">{children}</div>
          <p className="auth-console-footnote">ATHENSAI · CAREER NAVIGATION</p>
        </div>
      </main>
    </div>
  );
}
