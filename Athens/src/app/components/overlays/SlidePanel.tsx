"use client";

import React from "react";
import { cn } from "../../lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../ui/sheet";

const WIDTHS = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
} as const;

type SlidePanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  width?: keyof typeof WIDTHS;
  className?: string;
  side?: "left" | "right";
  showClose?: boolean;
  /**
   * When true, ignore outside pointer/focus and Escape dismiss.
   * Use when a higher-layer modal (e.g. video player) is open over the panel.
   */
  lockDismiss?: boolean;
};

export function SlidePanel({
  open,
  onOpenChange,
  children,
  width = "md",
  className,
  side = "right",
  showClose = true,
  lockDismiss = false,
}: SlidePanelProps) {
  return (
    // modal=false while a higher layer (video player) is open so Radix does not
    // inert the rest of the document / trap focus away from the player.
    <Sheet open={open} onOpenChange={onOpenChange} modal={!lockDismiss}>
      <SheetContent
        side={side}
        aria-describedby={undefined}
        className={cn(
          "w-full p-0 gap-0 flex flex-col bg-card border-border shadow-xl",
          WIDTHS[width],
          !showClose && "[&>button]:hidden",
          lockDismiss && "bm-sheet-locked",
          className,
        )}
        onPointerDownOutside={(event) => {
          if (lockDismiss) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (lockDismiss) event.preventDefault();
        }}
        onFocusOutside={(event) => {
          if (lockDismiss) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (lockDismiss) event.preventDefault();
        }}
      >
        <SheetTitle className="sr-only">Panel</SheetTitle>
        <SheetDescription className="sr-only">Details panel</SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  );
}
