import React from "react";
import { cn } from "../../lib/utils";
import { Input } from "../ui/input";
import { athensInputClass } from "./formTokens";

type AthensInputProps = React.ComponentProps<typeof Input>;

export const AthensInput = React.forwardRef<HTMLInputElement, AthensInputProps>(
  function AthensInput({ className, ...props }, ref) {
    return (
      <Input
        ref={ref}
        className={cn(
          athensInputClass,
          "h-auto border-border bg-secondary shadow-none focus-visible:ring-0 focus-visible:border-primary/40",
          className,
        )}
        {...props}
      />
    );
  },
);
