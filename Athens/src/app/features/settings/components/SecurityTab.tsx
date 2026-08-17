import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useAuth } from "@/context/auth-context";
import { AthensInput, FormField } from "../../../components/forms";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import {
  changePassword,
  deleteAccount,
  type DeleteAccountProgress,
} from "../../../services/profileApi";
import { clearResumeStorage } from "../../../services/resumeStorage";
import { DeleteAccountProgressPanel } from "./DeleteAccountProgressPanel";

/** Client keys tied to the signed-in applier — clear on account wipe. */
async function clearApplierLocalData(applierName: string) {
  const keysToRemove: string[] = [
    "athens_auth_user",
    "athens_auth_expires_at",
    "athens-profile",
    "athens-resume-ai-defaults",
    "athens-job-bookmarks",
  ];
  if (applierName) {
    keysToRemove.push(`resumeGeneratorConfig:${applierName}`);
  }
  for (const key of keysToRemove) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  await Promise.allSettled([clearResumeStorage()]);
}

const INITIAL_PROGRESS: DeleteAccountProgress = {
  phase: "verifying",
  message: "Starting…",
  removed: 0,
  total: 0,
  percent: 0,
};

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
  const [deleteProgress, setDeleteProgress] = useState<DeleteAccountProgress | null>(
    null,
  );

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
    setDeleteProgress(INITIAL_PROGRESS);
    try {
      const res = await deleteAccount(
        user.name,
        deletePassword,
        deleteConfirmName,
        (progress) => setDeleteProgress(progress),
      );
      if (!res.success) {
        toast.error(res.message || "Could not delete account");
        setDeleteProgress(null);
        return;
      }
      setDeleteProgress((prev) => ({
        phase: "done",
        message: "Finishing on this device…",
        removed: prev?.removed ?? 0,
        total: prev?.total ?? 0,
        percent: 100,
      }));
      await clearApplierLocalData(user.name);
      signout();
      setDeleteOpen(false);
      toast.success("Account deleted");
      navigate("/signin", { replace: true });
    } catch {
      toast.error("Could not delete account");
      setDeleteProgress(null);
    } finally {
      setDeleting(false);
    }
  };

  const showProgress = deleting && deleteProgress != null;

  return (
    <div className="max-w-md space-y-4">
      <div className="athens-settings__head">
        <div className="min-w-0">
          <h2 className="athens-settings__title">Security</h2>
          <p className="athens-settings__lede">Update your account password</p>
        </div>
      </div>
      <div className="athens-card">
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
          className="athens-btn-primary"
        >
          {saving ? "Updating…" : "Update password"}
        </button>
      </div>

      <div className="athens-card">
        <div>
          <h3 className="athens-card-title athens-settings__danger">Delete account</h3>
          <p className="athens-card-meta mt-1">
            Permanently remove your account, profile, generated résumés, agent history, bid
            recordings, and related data. This cannot be undone.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDeletePassword("");
            setDeleteConfirmName("");
            setDeleteProgress(null);
            setDeleteOpen(true);
          }}
          disabled={!user?.name}
          className="athens-btn-danger"
        >
          Delete account…
        </button>
      </div>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (deleting) return;
          setDeleteOpen(open);
          if (!open) setDeleteProgress(null);
        }}
      >
        <AlertDialogContent className="athens-ui athens-dialog flex flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <AlertDialogHeader className="athens-dialog-header">
            <AlertDialogTitle className="athens-settings__title">
              {showProgress ? "Deleting account…" : "Delete account permanently?"}
            </AlertDialogTitle>
            {!showProgress ? (
              <AlertDialogDescription className="athens-settings__lede">
                This deletes profile information, résumés, templates, agent runs, bid queue data,
                and mail sync for{" "}
                <strong>{user?.name}</strong>. Type your
                account name and password to confirm.
              </AlertDialogDescription>
            ) : (
              <AlertDialogDescription className="athens-settings__lede">
                Please keep this window open while we remove Firebase files, bid history, résumés,
                and your account.
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>

          <div className="athens-dialog-body">
            {showProgress && deleteProgress ? (
              <DeleteAccountProgressPanel progress={deleteProgress} />
            ) : (
              <div className="space-y-3">
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
            )}
          </div>

          <AlertDialogFooter className="athens-dialog-footer">
            {!showProgress ? (
              <>
                <button type="button" className="athens-btn" disabled={deleting} onClick={() => setDeleteOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    deleting ||
                    !user?.name ||
                    deleteConfirmName !== user.name ||
                    !deletePassword
                  }
                  className="athens-btn-danger"
                  onClick={() => void confirmDelete()}
                >
                  Delete forever
                </button>
              </>
            ) : (
              <p className="w-full text-center athens-card-meta py-1">
                This may take a minute for large accounts.
              </p>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
