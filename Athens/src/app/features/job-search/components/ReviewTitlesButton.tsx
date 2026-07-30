import { ListChecks, Loader2 } from "lucide-react";
import { useNavigate } from "react-router";
import { useApplier } from "@/context/applier-context";
import { Button } from "@/app/components/ui/button";
import { PATHS } from "@/app/config/routes";
import { isBetaTier } from "@/app/lib/beta";
import { useTitleReviewSession } from "../../title-review/useTitleReviewSession";

export function ReviewTitlesButton() {
  const navigate = useNavigate();
  const { applier } = useApplier();
  const enabled = isBetaTier(applier?.tier);
  const { session } = useTitleReviewSession({ enabled });
  if (!enabled) return null;

  const processed = session.processed ?? 0;
  const total = session.total ?? 0;
  const count = session.reviewRequiredCount;
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-9 gap-1.5 shrink-0"
      onClick={() => navigate(PATHS.titleReview)}
      title="Open titles that require manual review"
    >
      {session.running ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />}
      <span>{session.running ? `Reviewing ${processed}/${total}` : "Review titles"}</span>
      {count != null && count > 0 ? (
        <span className="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white tabular-nums">
          {count > 999 ? "999+" : count}
        </span>
      ) : null}
    </Button>
  );
}

