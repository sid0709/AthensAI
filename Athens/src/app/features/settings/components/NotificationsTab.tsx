import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import { AthensSwitch } from "../../../components/forms";
import {
  DEFAULT_NOTIFICATION_PREFS,
  fetchNotificationPrefs,
  saveNotificationPrefs,
  type NotificationPrefs,
} from "../../../services/profileApi";

const NOTIFICATION_GROUPS = [
  { id: "applications" as const, label: "Application updates", description: "Status changes and recruiter replies" },
  { id: "interviews" as const, label: "Interview reminders", description: "24h and 1h before scheduled interviews" },
  { id: "jobs" as const, label: "New job matches", description: "When high-match roles are found" },
  { id: "mail" as const, label: "Email digests", description: "Unread recruiter messages" },
];

export function NotificationsTab() {
  const { applier, applierReady } = useApplier();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!applier?.name) {
      setPrefs(DEFAULT_NOTIFICATION_PREFS);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchNotificationPrefs(applier.name);
      setPrefs(data);
      setDirty(false);
    } catch {
      toast.error("Could not load notification preferences");
    } finally {
      setLoading(false);
    }
  }, [applier?.name]);

  useEffect(() => {
    if (!applierReady) return;
    void load();
  }, [applierReady, load]);

  const updatePref = (id: keyof NotificationPrefs, checked: boolean) => {
    setPrefs((p) => ({ ...p, [id]: checked }));
    setDirty(true);
  };

  const save = async () => {
    if (!applier?.name) {
      toast.warning("Sign in to save notification preferences");
      return;
    }
    setSaving(true);
    try {
      const res = await saveNotificationPrefs(applier.name, prefs);
      if (res.success) {
        toast.success("Notification preferences saved");
        setDirty(false);
      } else {
        toast.error(res.error || "Save failed");
      }
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!applierReady) {
    return (
      <div className="athens-settings__loading">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="athens-toolbar mb-2">
        <div className="athens-surface">
          <div className="athens-toolbar-row">
            <div className="min-w-0">
              <h2 className="athens-settings__title">Notifications</h2>
              <p className="athens-settings__lede">Choose what Athens should notify you about</p>
            </div>
            <div className="athens-toolbar-actions ml-auto">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || loading || !dirty || !applier?.name}
                className="athens-btn-primary"
              >
                {saving ? "Saving…" : dirty ? "Save" : "Saved"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="athens-card athens-settings__loading">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading preferences…
        </div>
      ) : (
        NOTIFICATION_GROUPS.map((g) => (
          <div key={g.id} className="athens-card">
            <AthensSwitch
              label={g.label}
              description={g.description}
              checked={prefs[g.id]}
              onCheckedChange={(checked) => updatePref(g.id, checked)}
            />
          </div>
        ))
      )}
    </div>
  );
}
