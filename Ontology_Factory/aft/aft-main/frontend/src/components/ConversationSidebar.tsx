import { History, MessageSquarePlus, Trash2 } from "lucide-react";

import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import type { Conversation } from "@/lib/qa";
import { cn } from "@/lib/utils";

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeConversationId: string;
  onCreateConversation: () => void;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  onCreateConversation,
  onSelectConversation,
  onDeleteConversation,
}: ConversationSidebarProps) {
  return (
    <aside className="hidden lg:flex w-72 shrink-0 border-r bg-white/70 dark:bg-zinc-900/60 backdrop-blur flex-col">
      <div className="p-4 border-b space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          <History className="w-3.5 h-3.5" />
          Conversations
        </div>
        <Button className="w-fit px-4 h-9 min-h-0 text-xs rounded-xl flex items-center justify-center gap-2" onClick={onCreateConversation}>
          <MessageSquarePlus className="w-3.5 h-3.5" />
          <span>New chat</span>
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {conversations.map((conversation) => {
            const isActive = conversation.id === activeConversationId;
            const firstMessage = conversation.messages[0]?.content ?? "";
            const displayTitle = conversation.title === "New chat" && firstMessage 
              ? (firstMessage.length > 5 ? `${firstMessage.slice(0, 5)}...` : firstMessage)
              : conversation.title;

            return (
              <div
                key={conversation.id}
                className={cn(
                  "group relative w-full rounded-xl border px-3 py-2 text-left transition-all max-w-full overflow-hidden flex items-center justify-between gap-3",
                  isActive
                    ? "border-primary/20 bg-primary/5 shadow-sm"
                    : "border-transparent bg-zinc-50/50 hover:bg-zinc-100 dark:bg-zinc-900/30 dark:hover:bg-zinc-900/40",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectConversation(conversation.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {displayTitle}
                  </div>
                </button>
                
                <div className="flex items-center gap-2">
                  {isActive ? (
                    <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteConversation(conversation.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </aside>
  );
}
