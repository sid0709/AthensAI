import React from "react";
import { useCopilotChat } from "../../hooks/useCopilotChat";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { ChatHeader } from "./components/ChatHeader";
import { MessageList } from "./components/MessageList";
import { ChatInput } from "./components/ChatInput";
import { ContextPanel } from "./components/ContextPanel";

export function CopilotPage() {
  const chat = useCopilotChat();

  return (
    <div className="h-full flex overflow-hidden">
      <ConversationSidebar
        conversations={chat.conversations.map((c) => c.title)}
        activeConv={chat.activeConv}
        onSelect={chat.setActiveConv}
        onNewChat={chat.newChat}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <ChatHeader />
        <MessageList msgs={chat.msgs} typing={chat.typing} endRef={chat.endRef} />
        <ChatInput input={chat.input} typing={chat.typing} onChange={chat.setInput} onSend={chat.send} />
      </div>
      <ContextPanel
        onQuickAction={chat.dispatchQuickAction}
        workflows={chat.workflows}
        onToggleWorkflow={chat.toggleWorkflow}
      />
    </div>
  );
}
