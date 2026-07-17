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
  { id: "jobs" as const, label: "New job matches", description: "When agents find high-match roles" },
  { id: "agents" as const, label: "Agent run summaries", description: "Daily digest of agent activity" },
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
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <div>
          <h2 className="text-lg font-bold text-foreground">Notifications</h2>
          <p className="text-sm text-muted-foreground">Choose what Athens should notify you about</p>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || loading || !dirty || !applier?.name}
          className="bg-primary text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 min-h-10 disabled:opacity-50"
        >
          {saving ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading preferences…
        </div>
      ) : (
        NOTIFICATION_GROUPS.map((g) => (
          <div key={g.id} className="bg-card border border-border rounded-xl p-4 shadow-sm">
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
