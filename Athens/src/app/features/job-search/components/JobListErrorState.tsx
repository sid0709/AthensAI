import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "../../../components/ui/button";

export function JobListErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="my-8 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
      <AlertCircle className="mx-auto mb-3 size-6 text-destructive" aria-hidden />
      <p className="text-sm text-foreground">{message}</p>
      <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        <RefreshCw className="size-4" />
        Retry
      </Button>
    </div>
  );
}
