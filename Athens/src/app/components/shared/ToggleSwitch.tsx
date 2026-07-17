import { cn } from "../../lib/utils";

type ToggleSwitchProps = {
  on: boolean;
};

export function ToggleSwitch({ on }: ToggleSwitchProps) {
  return (
    <div
      className={cn(
        "w-10 h-5 rounded-full flex items-center transition-colors",
        on ? "bg-primary" : "bg-secondary border border-border"
      )}
    >
      <div
        className={cn(
          "w-4 h-4 rounded-full bg-white transition-transform mx-0.5 shadow-sm",
          on ? "translate-x-5" : ""
        )}
      />
    </div>
  );
}
