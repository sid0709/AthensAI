import { KeyRound } from "lucide-react";
import type { InboxMessage } from "../types";

interface MailSenderIconProps {
  message: InboxMessage;
  size: "list" | "detail";
}

export function MailSenderIcon({ message, size }: MailSenderIconProps) {
  return (
    <span className={`mail-sender-icon mail-sender-icon--${size}`} aria-hidden="true">
      {message.kind === "security-code"
        ? <KeyRound size={size === "detail" ? 20 : 15} />
        : <span>{message.sender.trim().charAt(0).toUpperCase() || "@"}</span>}
    </span>
  );
}
