import { useState } from "react";
import { AthensInput, AthensSelect, FormField } from "../../../components/forms";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import type { MailLabel } from "../../../types";

const NO_PARENT = "__none__";

type MailCreateLabelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: MailLabel[];
  onCreate: (name: string, parentId?: string) => void | Promise<void>;
};

export function MailCreateLabelDialog({
  open,
  onOpenChange,
  labels,
  onCreate,
}: MailCreateLabelDialogProps) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState(NO_PARENT);

  const handleCreate = () => {
    if (!name.trim()) return;
    void Promise.resolve(onCreate(name.trim(), parentId === NO_PARENT ? undefined : parentId));
    setName("");
    setParentId(NO_PARENT);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle>Create label</DialogTitle>
          <DialogDescription>
            Creates the label in your Gmail account. Nested labels use Gmail&apos;s parent/child format.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <FormField label="Label name">
            <AthensInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Recruiter outreach"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </FormField>
          <AthensSelect
            label="Nest under (optional)"
            value={parentId}
            onChange={setParentId}
            placeholder="Top level"
            options={[
              { value: NO_PARENT, label: "— Top level —" },
              ...labels.map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
          <p className="text-xs text-muted-foreground">
            Nested labels appear indented under their parent in the sidebar, like Gmail.
          </p>
        </div>
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
            onClick={handleCreate}
            disabled={!name.trim()}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-primary text-white hover:bg-primary/90 min-h-10 disabled:opacity-50"
          >
            Create
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
