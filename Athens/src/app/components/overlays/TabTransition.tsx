import React from "react";
import { cn } from "../../lib/utils";

type TabTransitionProps = {
  tabKey: string;
  children: React.ReactNode;
  className?: string;
};

export function TabTransition({ tabKey, children, className }: TabTransitionProps) {
  return (
    <div
      key={tabKey}
      className={cn(
        "animate-in fade-in slide-in-from-bottom-2 duration-200 fill-mode-both",
        className,
      )}
    >
      {children}
    </div>
  );
}
