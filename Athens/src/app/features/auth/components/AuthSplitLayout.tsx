import type { ReactNode } from "react";
import { AuthHeroPanel } from "./AuthHeroPanel";

type AuthSplitLayoutProps = {
  children: ReactNode;
};

export function AuthSplitLayout({ children }: AuthSplitLayoutProps) {
  return (
    <div className="grid h-svh w-full overflow-hidden bg-background lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <AuthHeroPanel />
      <div className="flex min-h-0 flex-col justify-center overflow-y-auto border-l border-border/60 bg-card px-6 py-10 sm:px-10 xl:px-14">
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
