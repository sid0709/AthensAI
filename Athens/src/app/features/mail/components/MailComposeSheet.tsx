import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { aiWriteMail } from "@/api/mail";
import { useApplier } from "@/context/applier-context";
import { isBetaTier } from "../../../lib/beta";
import { AthensInput, AthensTextarea, FormField } from "../../../components/forms";
import { SlidePanel, SlidePanelHeader } from "../../../components/overlays";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import {
  AI_REPLY_INTENTS,
  type AiReplyIntentId,
  extractEmailAddress,
  threadPlainText,
} from "../lib/mailCompose";
import type { MailThread } from "../../../types";

type MailComposeSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (to: string, subject: string, body: string) => void | Promise<void>;
  sending?: boolean;
  replyTo?: MailThread | null;
  /** When true, open dedicated AI Reply flow and auto-draft */
  aiAssist?: boolean;
};

export function MailComposeSheet({
  open,
  onOpenChange,
  onSend,
  sending = false,
  replyTo,
  aiAssist = false,
}: MailComposeSheetProps) {
  const { applier } = useApplier();
  const applierName = applier?.name;
  const isBeta = isBetaTier(applier?.tier);
  const isAiReply = Boolean(aiAssist && replyTo);

  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [intentId, setIntentId] = useState<AiReplyIntentId>("polite");
  const [showAi, setShowAi] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const autoDraftKey = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      autoDraftKey.current = null;
      return;
    }
    setValidationError(null);
    setSendError(null);
    setAiBusy(false);
    setIntentId("polite");
    setShowAi(aiAssist || false);

    if (replyTo) {
      setTo(extractEmailAddress(replyTo));
      setSubject(replyTo.subj.startsWith("Re:") ? replyTo.subj : `Re: ${replyTo.subj}`);
      setBody("");
      const defaultIntent = AI_REPLY_INTENTS.find((i) => i.id === "polite")!;
      setAiPrompt(aiAssist ? defaultIntent.prompt : "");
      const addr = extractEmailAddress(replyTo);
      if (!addr) {
        setValidationError(
          "Could not detect the sender’s email. Enter the To address manually before sending.",
        );
      }
    } else {
      setTo("");
      setSubject("");
      setBody("");
      setAiPrompt("");
    }
  }, [open, replyTo, aiAssist]);

  // Auto-draft once when AI Reply opens with a thread that has readable content.
  useEffect(() => {
    if (!open || !isAiReply || !isBeta || !applierName || !replyTo) return;
    const key = `${replyTo.id}:ai-reply`;
    if (autoDraftKey.current === key) return;
    autoDraftKey.current = key;
    void generateDraft("reply", AI_REPLY_INTENTS.find((i) => i.id === "polite")!.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run once per open/thread
  }, [open, isAiReply, isBeta, applierName, replyTo?.id]);

  const buildReplyContext = () => {
    if (!replyTo) return undefined;
    return [
      `From: ${replyTo.fromEmail || replyTo.from}`,
      `Subject: ${replyTo.subj}`,
      "",
      threadPlainText(replyTo),
    ]
      .join("\n")
      .slice(0, 8000);
  };

  const resolvePrompt = (overridePrompt?: string) => {
    if (overridePrompt !== undefined) return overridePrompt.trim();
    if (isAiReply) {
      const intent = AI_REPLY_INTENTS.find((i) => i.id === intentId);
      if (intentId === "custom") return aiPrompt.trim();
      return (intent?.prompt || aiPrompt).trim();
    }
    return aiPrompt.trim();
  };

  const generateDraft = async (mode: "write" | "reply", overridePrompt?: string) => {
    if (!applierName || aiBusy) return;
    const prompt = resolvePrompt(overridePrompt);
    const replyContext = buildReplyContext();

    if (mode === "write" && !prompt && !replyContext) {
      setSendError("Enter a prompt describing what you want to write.");
      return;
    }
    if (mode === "reply" && !replyContext && !prompt) {
      setSendError("Nothing to reply to yet — wait for the message to finish loading.");
      return;
    }

    setSendError(null);
    setAiBusy(true);
    try {
      const result = await aiWriteMail(applierName, {
        mode,
        prompt: prompt || undefined,
        subject: subject.trim() || undefined,
        replyContext,
      });
      setBody(result.body);
      setShowAi(true);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "AI write failed");
    } finally {
      setAiBusy(false);
    }
  };

  const fineTune = async () => {
    if (!applierName || aiBusy) return;
    if (!body.trim()) {
      setSendError("Write a draft first, then fine-tune grammar.");
      return;
    }
    setSendError(null);
    setAiBusy(true);
    try {
      const result = await aiWriteMail(applierName, {
        mode: "fine-tune",
        body: body.trim(),
        subject: subject.trim() || undefined,
        replyContext: buildReplyContext(),
      });
      setBody(result.body);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "AI fine-tune failed");
    } finally {
      setAiBusy(false);
    }
  };

  const selectIntent = (id: AiReplyIntentId) => {
    setIntentId(id);
    const intent = AI_REPLY_INTENTS.find((i) => i.id === id);
    if (id !== "custom" && intent?.prompt) {
      setAiPrompt(intent.prompt);
      void generateDraft("reply", intent.prompt);
    }
  };

  const handleSend = async () => {
    if (sending || aiBusy) return;
    if (!to.trim()) {
      setValidationError("Recipient (To) is required.");
      return;
    }
    if (!to.includes("@")) {
      setValidationError("Recipient must be a valid email address.");
      return;
    }
    if (!subject.trim()) {
      setValidationError("Subject is required.");
      return;
    }
    if (!body.trim()) {
      setValidationError("Message body is required.");
      return;
    }
    setValidationError(null);
    setSendError(null);
    try {
      await onSend(to.trim(), subject.trim(), body);
      setTo("");
      setSubject("");
      setBody("");
      setAiPrompt("");
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed to send mail");
    }
  };

  const panelTitle = isAiReply ? "AI Reply" : replyTo ? "Reply" : "Compose";

  return (
    <SlidePanel open={open} onOpenChange={onOpenChange} width="md">
      <SlidePanelHeader title={panelTitle} onClose={() => onOpenChange(false)} />
      <div className="p-5 space-y-4 flex-1 overflow-y-auto">
        {(validationError || sendError) && (
          <div className="px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
            {validationError || sendError}
          </div>
        )}

        {replyTo && (
          <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">
              Replying to
            </p>
            <p className="text-sm font-semibold text-foreground truncate">{replyTo.from}</p>
            <p className="text-xs text-muted-foreground truncate">{replyTo.subj}</p>
          </div>
        )}

        <FormField label="To">
          <AthensInput value={to} onChange={(e) => setTo(e.target.value)} placeholder="recruiter@company.com" />
        </FormField>
        <FormField label="Subject">
          <AthensInput value={subject} onChange={(e) => setSubject(e.target.value)} />
        </FormField>

        {isBeta && isAiReply && (
          <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              How should this reply sound?
            </p>
            <div className="flex flex-wrap gap-1.5">
              {AI_REPLY_INTENTS.map((intent) => (
                <button
                  key={intent.id}
                  type="button"
                  disabled={aiBusy || sending}
                  onClick={() => selectIntent(intent.id)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors min-h-8",
                    intentId === intent.id
                      ? "bg-primary text-white border-primary"
                      : "bg-background text-muted-foreground border-border hover:text-foreground hover:bg-secondary",
                  )}
                >
                  {intent.label}
                </button>
              ))}
            </div>
            {intentId === "custom" && (
              <AthensTextarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={2}
                placeholder="Describe the reply you want…"
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={aiBusy || sending || (intentId === "custom" && !aiPrompt.trim())}
                onClick={() => void generateDraft("reply")}
              >
                {aiBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                )}
                {body.trim() ? "Regenerate" : "Generate draft"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={aiBusy || sending || !body.trim()}
                onClick={() => void fineTune()}
              >
                {aiBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5 mr-1.5" />
                )}
                Fine-tune grammar
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Fine-tune only fixes grammar and clarity — it keeps your meaning.
            </p>
          </div>
        )}

        {isBeta && !isAiReply && (
          <div className="space-y-2 rounded-xl border border-border bg-secondary/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                AI Write
              </p>
              <button
                type="button"
                className="text-xs font-semibold text-primary hover:underline"
                onClick={() => setShowAi((v) => !v)}
              >
                {showAi ? "Hide" : "Show"}
              </button>
            </div>
            {showAi && (
              <>
                <AthensTextarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  rows={3}
                  placeholder="Describe what you want to write…"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={aiBusy || sending}
                    onClick={() => void generateDraft(replyTo ? "reply" : "write")}
                  >
                    {aiBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Generate
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={aiBusy || sending || !body.trim()}
                    onClick={() => void fineTune()}
                  >
                    {aiBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    ) : (
                      <Wand2 className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Fine-tune grammar
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        <FormField label="Message">
          {aiBusy && !body.trim() ? (
            <div className="rounded-xl border border-border bg-muted/30 px-3 py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Drafting your reply…
            </div>
          ) : (
            <AthensTextarea value={body} onChange={(e) => setBody(e.target.value)} rows={isAiReply ? 10 : 8} />
          )}
        </FormField>
      </div>
      <div className="p-5 border-t border-border">
        <Button className="w-full" onClick={() => void handleSend()} disabled={sending || aiBusy}>
          {sending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Sending…
            </>
          ) : (
            "Send"
          )}
        </Button>
      </div>
    </SlidePanel>
  );
}
