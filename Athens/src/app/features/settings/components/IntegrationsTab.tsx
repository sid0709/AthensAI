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
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { Input } from "../../../components/ui/input";

function NotionMark() {
  return <div className="athens-settings__mark">N</div>;
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
      <div className="athens-card">
        <div className="flex items-center gap-4">
          <NotionMark />
          <div className="min-w-0 flex-1">
            <p className="athens-card-title">Notion</p>
            <p className="athens-card-meta mt-0.5">
              Browse shared pages and show Call Record in Calendar
            </p>
            {status.connected && (
              <p className="athens-card-meta mt-1 truncate">
                {status.bot?.workspaceName || status.bot?.name || "Connected workspace"}
                {status.callRecord?.dateProperty?.name
                  ? ` · Calendar date: ${status.callRecord.dateProperty.name}`
                  : ""}
              </p>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center gap-3">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <span className="athens-status">
                {status.connected ? "Connected" : "Disconnected"}
              </span>
            )}
            <button
              type="button"
              disabled={loading}
              onClick={() => (status.connected ? setDisconnectOpen(true) : setConnectOpen(true))}
              className={status.connected ? "athens-btn-danger" : "athens-btn-primary"}
            >
              {status.connected ? "Disconnect" : "Connect"}
            </button>
          </div>
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
        <DialogContent className="athens-ui athens-dialog athens-settings flex flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="athens-dialog-header">
            <DialogTitle className="athens-settings__title">Connect Notion</DialogTitle>
            <DialogDescription className="athens-settings__lede">
              Enter an internal integration token. Before confirming, share a database named exactly
              “Call Record” with that connection and give it Read content access.
            </DialogDescription>
          </DialogHeader>
          <div className="athens-dialog-body space-y-3">
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
              className="athens-link inline-flex items-center gap-1"
            >
              Open Notion integrations <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {error && (
              <div className="athens-callout athens-settings__danger">
                {error}
              </div>
            )}
            {!error && token.trim() && (
              <p className="flex items-center gap-1.5 athens-card-meta">
                <CheckCircle2 className="h-3.5 w-3.5" />
                The token will be encrypted and never returned to this browser.
              </p>
            )}
          </div>
          <DialogFooter className="athens-dialog-footer">
            <button
              type="button"
              onClick={() => setConnectOpen(false)}
              disabled={saving}
              className="athens-btn"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={!token.trim() || saving}
              className="athens-btn-primary"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm connection
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={disconnectOpen} onOpenChange={(open) => !saving && setDisconnectOpen(open)}>
        <AlertDialogContent className="athens-ui athens-dialog flex flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <AlertDialogHeader className="athens-dialog-header">
            <AlertDialogTitle className="athens-settings__title">Disconnect Notion?</AlertDialogTitle>
            <AlertDialogDescription className="athens-settings__lede">
              This removes the stored token and immediately hides Notion data from the browser and Calendar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="athens-dialog-footer">
            <button type="button" className="athens-btn" disabled={saving} onClick={() => setDisconnectOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleDisconnect()}
              className="athens-btn-danger"
            >
              {saving ? "Disconnecting…" : "Disconnect"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
