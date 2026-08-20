import { useState } from "react";
import { toast } from "sonner";
import { useAuth, type AuthUser } from "@/context/auth-context";
import { AthensInput, FormField } from "../../../components/forms";
import { changeUsername } from "../../../services/profileApi";

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

function migrateApplierLocalKeys(oldName: string, newName: string) {
  const from = `resumeGeneratorConfig:${oldName}`;
  const to = `resumeGeneratorConfig:${newName}`;
  try {
    const raw = localStorage.getItem(from);
    if (raw && !localStorage.getItem(to)) localStorage.setItem(to, raw);
    localStorage.removeItem(from);
  } catch {
    /* ignore */
  }
}

export function SecurityUsernameCard() {
  const { user, replaceUser } = useAuth();
  const [nextName, setNextName] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!user?.name) {
      toast.warning("Sign in to change your username");
      return;
    }
    const trimmed = nextName.trim();
    if (!trimmed) {
      toast.error("Enter a new username");
      return;
    }
    if (
      trimmed.length < 2 ||
      trimmed.length > 64 ||
      !USERNAME_PATTERN.test(trimmed)
    ) {
      toast.error(
        "Username must be 2–64 characters and use only letters, numbers, dots, hyphens, or underscores",
      );
      return;
    }
    if (!password) {
      toast.error("Enter your password to confirm");
      return;
    }
    setSaving(true);
    try {
      const res = await changeUsername(user.name, trimmed, password);
      if (!res.success || !res.user?.name) {
        toast.error(res.message || "Could not update username");
        return;
      }
      const nextUser: AuthUser = {
        _id: res.user._id ?? user._id,
        name: res.user.name,
        tier: res.user.tier ?? user.tier,
        permission: res.user.permission ?? user.permission,
      };
      migrateApplierLocalKeys(user.name, nextUser.name);
      replaceUser(nextUser);
      setNextName("");
      setPassword("");
      toast.success("Username updated");
    } catch {
      toast.error("Could not update username");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="athens-card">
      <div>
        <h3 className="athens-card-title">Account username</h3>
        <p className="athens-card-meta mt-1">
          This is the login name vendors and you use to sign in. It is not the full
          name on your autobid profile.
        </p>
      </div>
      <FormField label="Current username">
        <AthensInput value={user?.name ?? ""} readOnly className="max-w-sm" />
      </FormField>
      <FormField label="New username">
        <AthensInput
          value={nextName}
          onChange={(e) => setNextName(e.target.value)}
          autoComplete="username"
          className="max-w-sm"
          placeholder="letters, numbers, dots, hyphens, underscores"
        />
      </FormField>
      <FormField label="Password">
        <AthensInput
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="max-w-sm"
        />
      </FormField>
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !user?.name}
        className="athens-btn-primary"
      >
        {saving ? "Updating…" : "Update username"}
      </button>
    </div>
  );
}
