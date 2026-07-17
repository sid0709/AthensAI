import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/context/auth-context";
import { AthensInput, FormField } from "../../../components/forms";
import { changePassword } from "../../../services/profileApi";

export function SecurityTab() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="max-w-md space-y-5">
      <div>
        <h2 className="text-lg font-bold text-foreground">Security</h2>
        <p className="text-sm text-muted-foreground">Update your account password</p>
      </div>
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
        <FormField label="Current password">
          <AthensInput type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" className="max-w-sm" />
        </FormField>
        <FormField label="New password">
          <AthensInput type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" className="max-w-sm" />
        </FormField>
        <FormField label="Confirm new password">
          <AthensInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className="max-w-sm" />
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
    </div>
  );
}
