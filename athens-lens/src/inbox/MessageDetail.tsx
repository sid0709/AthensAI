import { ArrowLeft, Check, Copy, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { InboxMessage } from "../types";
import { MailSenderIcon } from "./MailSenderIcon";
import { MessageBodyParagraphs } from "./MessageBodyParagraphs";

interface MessageDetailProps {
  message: InboxMessage;
  bodyError: string | null;
  onRetry(): void;
  onBack(): void;
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

export function MessageDetail({ message, bodyError, onRetry, onBack }: MessageDetailProps) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    if (!message.securityCode) return;

    await navigator.clipboard.writeText(message.securityCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <article className="job-detail message-detail" aria-labelledby="message-detail-title">
      <header className="detail-toolbar">
        <button className="back-button" type="button" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" />
          <span>Inbox</span>
        </button>
        <span className="detail-toolbar-label">Gmail message</span>
      </header>

      <div className="detail-scroll">
        <div className="detail-content message-content">
          <section className="message-heading">
            <MailSenderIcon message={message} size="detail" />
            <div>
              <h1 id="message-detail-title">{message.subject}</h1>
              <p><strong>{message.sender}</strong> &lt;{message.senderEmail}&gt;</p>
              <time dateTime={message.receivedAt}>{DATE_TIME_FORMAT.format(new Date(message.receivedAt))}</time>
            </div>
          </section>

          {message.securityCode ? (
            <section className="security-code-card" aria-label="Security code">
              <div>
                <span>Security code</span>
                <strong>{message.securityCode}</strong>
              </div>
              <button className="secondary-button" type="button" onClick={() => void copyCode()}>
                {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                {copied ? "Copied" : "Copy code"}
              </button>
            </section>
          ) : null}

          {bodyError ? (
            <section className="message-body-state" role="status">
              <p>{bodyError}</p>
              <button className="secondary-button" type="button" onClick={onRetry}>
                <RefreshCw size={16} aria-hidden="true" />Try again
              </button>
            </section>
          ) : !message.bodyLoaded ? (
            <section className="message-body-state" role="status">
              <LoaderCircle className="loading-spinner" size={18} aria-hidden="true" />
              <p>Loading message…</p>
            </section>
          ) : (
            <section className="message-body">
              <MessageBodyParagraphs paragraphs={message.body} />
            </section>
          )}
        </div>
      </div>
    </article>
  );
}
