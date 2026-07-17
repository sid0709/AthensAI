import { useState, useRef, useEffect, useCallback } from "react";
import { INIT_MSGS, AI_REPLY, COPILOT_CONVERSATIONS } from "../data/copilot";
import type { Msg } from "../types";

type Conversation = { id: string; title: string; msgs: Msg[] };

export function useCopilotChat() {
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    COPILOT_CONVERSATIONS.map((title, i) => ({
      id: `conv-${i}`,
      title,
      msgs: i === 0 ? INIT_MSGS : [],
    })),
  );
  const [activeConv, setActiveConv] = useState(0);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [workflows, setWorkflows] = useState<Record<string, boolean>>({
    "Auto-tailor resumes": true,
    "Follow-up drafts": false,
    "Interview prep": true,
  });
  const endRef = useRef<HTMLDivElement>(null);

  const msgs = conversations[activeConv]?.msgs ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, typing]);

  const send = useCallback(() => {
    if (!input.trim() || typing) return;
    const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const userMsg: Msg = { id: Date.now().toString(), role: "user", content: input, ts };
    setConversations((prev) =>
      prev.map((c, i) => (i === activeConv ? { ...c, msgs: [...c.msgs, userMsg] } : c)),
    );
    setInput("");
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      const aiMsg: Msg = {
        id: (Date.now() + 1).toString(),
        role: "ai",
        ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        content: AI_REPLY,
      };
      setConversations((prev) =>
        prev.map((c, i) => (i === activeConv ? { ...c, msgs: [...c.msgs, aiMsg] } : c)),
      );
    }, 1800);
  }, [input, typing, activeConv]);

  const newChat = useCallback(() => {
    const conv: Conversation = {
      id: `conv-${Date.now()}`,
      title: "New conversation",
      msgs: [],
    };
    setConversations((prev) => [conv, ...prev]);
    setActiveConv(0);
  }, []);

  const dispatchQuickAction = useCallback((action: string) => {
    setInput(action);
  }, []);

  const toggleWorkflow = useCallback((name: string, on: boolean) => {
    setWorkflows((prev) => ({ ...prev, [name]: on }));
  }, []);

  return {
    msgs,
    input,
    setInput,
    typing,
    activeConv,
    setActiveConv,
    conversations,
    endRef,
    send,
    newChat,
    dispatchQuickAction,
    workflows,
    toggleWorkflow,
  };
}
