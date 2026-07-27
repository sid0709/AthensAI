import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import {
  connectNotion,
  disconnectNotion,
  fetchNotionStatus,
  type NotionStatus,
} from "../../../services/notionApi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
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
import { Input } from "../../../components/ui/input";

function NotionMark() {
  return (
    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-foreground text-xl font-black text-background">
      N
    </div>
  );
}

export function IntegrationsTab() {
  const { applier } = useApplier();
  const [status, setStatus] = useState<NotionStatus>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!applier?.name) return;
    setLoading(true);
    try {
      setStatus(await fetchNotionStatus(applier.name));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Notion status");
    } finally {
      setLoading(false);
    }
  }, [applier?.name]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConnect = async () => {
    if (!applier?.name || !token.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const next = await connectNotion(applier.name, token.trim());
      setStatus(next);
      setToken("");
      setConnectOpen(false);
      toast.success("Notion connected");
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Could not connect Notion");
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!applier?.name) return;
    setSaving(true);
    try {
      await disconnectNotion(applier.name);
      setStatus({ connected: false });
      setDisconnectOpen(false);
      toast.success("Notion disconnected");
    } catch (disconnectError) {
      toast.error(disconnectError instanceof Error ? disconnectError.message : "Could not disconnect Notion");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-5 rounded-xl border border-border bg-card p-5 shadow-sm">
        <NotionMark />
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-foreground">Notion</p>
          <p className="text-sm text-muted-foreground">
            Browse shared pages and show Call Record in Calendar
          </p>
          {status.connected && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {status.bot?.workspaceName || status.bot?.name || "Connected workspace"}
              {status.callRecord?.dateProperty?.name
                ? ` · Calendar date: ${status.callRecord.dateProperty.name}`
                : ""}
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-4">
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <span className={status.connected ? "text-sm font-bold text-emerald-600" : "text-sm font-bold text-muted-foreground"}>
              {status.connected ? "Connected" : "Disconnected"}
            </span>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={() => (status.connected ? setDisconnectOpen(true) : setConnectOpen(true))}
            className={
              status.connected
                ? "min-h-10 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                : "min-h-10 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
            }
          >
            {status.connected ? "Disconnect" : "Connect"}
          </button>
        </div>
      </div>

      <Dialog
        open={connectOpen}
        onOpenChange={(open) => {
          if (!saving) {
            setConnectOpen(open);
            if (!open) {
              setToken("");
              setError(null);
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect Notion</DialogTitle>
            <DialogDescription>
              Enter an internal integration token. Before confirming, share a database named exactly
              “Call Record” with that connection and give it Read content access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="ntn_… or secret_…"
              disabled={saving}
              onKeyDown={(event) => {
                if (event.key === "Enter" && token.trim() && !saving) void handleConnect();
              }}
            />
            <a
              href="https://www.notion.so/profile/integrations"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
            >
              Open Notion integrations <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            )}
            {!error && token.trim() && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                The token will be encrypted and never returned to this browser.
              </p>
            )}
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConnectOpen(false)}
              disabled={saving}
              className="min-h-10 rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={!token.trim() || saving}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm connection
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={disconnectOpen} onOpenChange={(open) => !saving && setDisconnectOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Notion?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the stored token and immediately hides Notion data from the browser and Calendar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                void handleDisconnect();
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {saving ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
