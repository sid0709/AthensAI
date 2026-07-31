import { ListChecks, Loader2 } from "lucide-react";
import { useNavigate } from "react-router";
import { useApplier } from "@/context/applier-context";
import { Button } from "@/app/components/ui/button";
import { PATHS } from "@/app/config/routes";
import { isBetaTier } from "@/app/lib/beta";
import { titleReviewToolbarCount } from "@/app/api/jobTitleReview";
import { useTitleReviewSession } from "../../title-review/useTitleReviewSession";

export function ReviewTitlesButton() {
  const navigate = useNavigate();
  const { applier } = useApplier();
  const enabled = isBetaTier(applier?.tier);
  const { session } = useTitleReviewSession({ enabled, pollWhenIdle: true });
  if (!enabled) return null;

  const processed = session.processed ?? 0;
  const total = session.total ?? 0;
  // This toolbar badge answers “how many titles have not been reviewed yet?”
  // Manual-review results have their own count inside the Review Titles page.
  const count = titleReviewToolbarCount(session);
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-9 gap-1.5 shrink-0"
      onClick={() => navigate(PATHS.titleReview)}
      title={count == null ? "Open title review" : `${count.toLocaleString()} title${count === 1 ? "" : "s"} awaiting review`}
    >
      {session.running ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />}
      <span>{session.running ? `Reviewing ${processed}/${total}` : "Review titles"}</span>
      {count != null ? (
        <span className={`inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums ${
          count === 0 ? "bg-muted text-muted-foreground" : "bg-amber-500 text-white"
        }`}>
          {count.toLocaleString()}
        </span>
      ) : null}
    </Button>
  );
}
