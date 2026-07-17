import React from "react";
import { cn } from "../../lib/utils";
import { athensErrorClass, athensHintClass, athensLabelClass } from "./formTokens";

type FormFieldProps = {
  label?: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
};

export function FormField({ label, hint, error, htmlFor, className, children }: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className={athensLabelClass}>
          {label}
        </label>
      )}
      {children}
      {hint && !error && <p className={athensHintClass}>{hint}</p>}
      {error && <p className={athensErrorClass}>{error}</p>}
    </div>
  );
}
