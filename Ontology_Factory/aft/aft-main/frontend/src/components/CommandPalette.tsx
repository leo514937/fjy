import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import { Code2, Send, Square } from "lucide-react";

export function CommandPalette({
  onSubmit,
  onStop,
  isLoading,
  isGitHubReviewing = false,
  disabled = false,
  onOpenGitHubReview,
}: {
  onSubmit: (val: string) => void;
  onStop: () => void;
  isLoading: boolean;
  isGitHubReviewing?: boolean;
  disabled?: boolean;
  onOpenGitHubReview?: () => void;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputDisabled = disabled || isLoading || isGitHubReviewing;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && value.trim() && !inputDisabled) {
      event.preventDefault();
      onSubmit(value.trim());
      setValue("");
    }
  };

  const handleSend = () => {
    if (isLoading) {
      onStop();
      return;
    }
    if (value.trim() && !inputDisabled) {
      onSubmit(value.trim());
      setValue("");
    }
  };

  return (
    <div className="relative flex w-full flex-col rounded-2xl border bg-white p-2 shadow-lg transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 dark:bg-zinc-900">
      <textarea
        ref={textareaRef}
        rows={1}
        className="min-h-[44px] w-full resize-none border-none bg-transparent px-3 py-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
        placeholder="输入问题或继续对话...（Shift + Enter 换行）"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <div className="flex items-center justify-between gap-2 p-1">
        <button
          onClick={onOpenGitHubReview}
          type="button"
          disabled={inputDisabled || !onOpenGitHubReview}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
          title="打开 GitHub 审查"
        >
          <Code2 className="h-3.5 w-3.5" />
          代码审查
        </button>
        {isLoading || isGitHubReviewing ? (
          <button
            onClick={onStop}
            type="button"
            className="group/stop relative flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive transition-all duration-200 hover:bg-destructive hover:text-white"
            title="停止生成"
          >
            <div className="absolute inset-0 rounded-lg bg-destructive/20 opacity-40 animate-ping group-hover/stop:hidden" />
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            type="button"
            disabled={!value.trim() || inputDisabled}
            className={`rounded-xl p-2.5 transition-all ${
              value.trim() && !inputDisabled
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:scale-105 active:scale-95"
                : "cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
            }`}
            title="发送消息"
          >
            <Send className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
