import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import type { MailLabel } from "../../../types";

type MailRemoveLabelDialogProps = {
  label: MailLabel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  removing?: boolean;
};

export function MailRemoveLabelDialog({
  label,
  open,
  onOpenChange,
  onConfirm,
  removing = false,
}: MailRemoveLabelDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle>Remove label</DialogTitle>
          <DialogDescription>
            Remove label &ldquo;{label?.name}&rdquo; from Gmail? Your messages will not be deleted —
            only the label is removed from them, like in Gmail.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-xl text-sm font-semibold border border-border hover:bg-secondary min-h-10"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={removing}
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-destructive text-white hover:bg-destructive/90 min-h-10 disabled:opacity-50"
          >
            {removing ? "Removing…" : "Remove label"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
