import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useAuth } from "@/context/auth-context";
import { AthensInput, FormField } from "../../../components/forms";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { changePassword, deleteAccount } from "../../../services/profileApi";

/** Client keys tied to the signed-in applier — clear on account wipe. */
function clearApplierLocalData(applierName: string) {
  const keysToRemove: string[] = [
    "athens_auth_user",
    "athens_auth_expires_at",
    "athens-profile",
    "athens-agent-sessions",
    "athens-avalon-session",
    "athens-agent-job-budget-usd",
    "athens-agent-allow-window-focus",
  ];
  if (applierName) {
    keysToRemove.push(`resumeGeneratorConfig:${applierName}`);
    keysToRemove.push(`athens-agent-queue-${applierName}`);
  }
  for (const key of keysToRemove) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  // Sweep any other agent-queue keys for this applier.
  try {
    const prefix = "athens-agent-queue-";
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix) && applierName && key.includes(applierName)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore */
  }
}

export function SecurityTab() {
  const { user, signout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    if (!user?.name) {
      toast.warning("Sign in to change your password");
      return;
    }
    if (!current || !next) {
      toast.error("Please fill in current and new password");
      return;
    }
    if (next.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (next !== confirm) {
      toast.error("New passwords do not match");
      return;
    }
    setSaving(true);
    try {
      const res = await changePassword(user.name, current, next);
      if (res.success) {
        toast.success("Password updated");
        setCurrent("");
        setNext("");
        setConfirm("");
      } else {
        toast.error(res.message || "Could not update password");
      }
    } catch {
      toast.error("Could not update password");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!user?.name) {
      toast.warning("Sign in to delete your account");
      return;
    }
    if (deleteConfirmName !== user.name) {
      toast.error(`Type your account name exactly: ${user.name}`);
      return;
    }
    if (!deletePassword) {
      toast.error("Enter your password to confirm");
      return;
    }
    setDeleting(true);
    try {
      const res = await deleteAccount(user.name, deletePassword, deleteConfirmName);
      if (!res.success) {
        toast.error(res.message || "Could not delete account");
        return;
      }
      clearApplierLocalData(user.name);
      signout();
      setDeleteOpen(false);
      toast.success("Account deleted");
      navigate("/signin", { replace: true });
    } catch {
      toast.error("Could not delete account");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-md space-y-5">
      <div>
        <h2 className="text-lg font-bold text-foreground">Security</h2>
        <p className="text-sm text-muted-foreground">Update your account password</p>
      </div>
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
        <FormField label="Current password">
          <AthensInput
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            className="max-w-sm"
          />
        </FormField>
        <FormField label="New password">
          <AthensInput
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            className="max-w-sm"
          />
        </FormField>
        <FormField label="Confirm new password">
          <AthensInput
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className="max-w-sm"
          />
        </FormField>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="bg-primary text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 min-h-10 disabled:opacity-50"
        >
          {saving ? "Updating…" : "Update password"}
        </button>
      </div>

      <div className="bg-card border border-destructive/30 rounded-xl p-5 shadow-sm space-y-3">
        <div>
          <h3 className="text-sm font-bold text-destructive">Delete account</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Permanently remove your account, profile, generated résumés, agent history, bid
            recordings, and related data. This cannot be undone.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDeletePassword("");
            setDeleteConfirmName("");
            setDeleteOpen(true);
          }}
          disabled={!user?.name}
          className="bg-destructive text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-destructive/90 min-h-10 disabled:opacity-50"
        >
          Delete account…
        </button>
      </div>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (deleting) return;
          setDeleteOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes profile information, résumés, templates, agent runs, bid queue data,
              and mail sync for{" "}
              <span className="font-semibold text-foreground">{user?.name}</span>. Type your
              account name and password to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-1">
            <FormField label={`Type "${user?.name ?? ""}" to confirm`}>
              <AthensInput
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                autoComplete="off"
                disabled={deleting}
              />
            </FormField>
            <FormField label="Password">
              <AthensInput
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                autoComplete="current-password"
                disabled={deleting}
              />
            </FormField>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                deleting ||
                !user?.name ||
                deleteConfirmName !== user.name ||
                !deletePassword
              }
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting ? "Deleting…" : "Delete forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
