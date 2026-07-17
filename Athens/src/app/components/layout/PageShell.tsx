import React from "react";

export function PageShell({
  children,
  className = "",
  fullWidth = false,
}: {
  children: React.ReactNode;
  className?: string;
  fullWidth?: boolean;
}) {
  return (
    <div className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden subtle-scroll ${className}`}>
      {fullWidth ? children : <div className="page-container pb-8">{children}</div>}
    </div>
  );
}
