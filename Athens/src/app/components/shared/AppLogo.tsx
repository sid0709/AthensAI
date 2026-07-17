import { cn } from "../../lib/utils";

type AppLogoProps = {
  size?: number;
  className?: string;
};

export function AppLogo({ size = 40, className }: AppLogoProps) {
  return (
    <img
      src="/logo.png"
      alt="AthenAI"
      width={size}
      height={size}
      className={cn("rounded-xl object-cover flex-shrink-0", className)}
    />
  );
}
