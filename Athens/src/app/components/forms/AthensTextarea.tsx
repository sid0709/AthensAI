import React from "react";
import { cn } from "../../lib/utils";
import { Textarea } from "../ui/textarea";
import { athensTextareaClass } from "./formTokens";

type AthensTextareaProps = React.ComponentProps<typeof Textarea> & {
  autoResize?: boolean;
};

export const AthensTextarea = React.forwardRef<HTMLTextAreaElement, AthensTextareaProps>(
  function AthensTextarea({ className, autoResize, onChange, ...props }, ref) {
    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (autoResize) {
        e.target.style.height = "auto";
        e.target.style.height = `${e.target.scrollHeight}px`;
      }
      onChange?.(e);
    };

    return (
      <Textarea
        ref={ref}
        className={cn(
          athensTextareaClass,
          "border-border bg-secondary shadow-none focus-visible:ring-0 focus-visible:border-primary/40",
          autoResize && "resize-none overflow-hidden",
          className,
        )}
        onChange={handleChange}
        {...props}
      />
    );
  },
);
