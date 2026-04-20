import React, { useRef, useEffect } from 'react';
import {
  Sparkles,
  AlertCircle,
  Copy,
  Check,
  ArrowUp,
  ArrowDown,
  Square,
  Terminal,
  CheckCircle2,
  AlertTriangle,
  LoaderCircle,
  Paperclip,
  Eye,
  GitCompareArrows,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AssistantMarkdown, copyCodeToClipboard } from './AssistantMarkdown';
import { cn } from '@/lib/utils';
import type {
  PersistedOntologyAssistantContentBlock,
  PersistedOntologyAssistantToolRun,
} from '@/features/assistant/api';

interface ChatAreaProps {
  activeSession: any;
  onAsk: (question?: string) => void;
  onStop: () => void;
  onDraftChange: (value: string) => void;
  onUploadFile: (file: File) => Promise<void>;
  isBusy: boolean;
  selectedEntityName?: string;
  renderSettings?: () => React.ReactNode;
  renderExtraActions?: () => React.ReactNode;
}

const TOOL_OUTPUT_PREVIEW_LIMIT = 4000;

function hasVisibleText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function formatToolRunStatus(toolRun: PersistedOntologyAssistantToolRun) {
  switch (toolRun.status) {
    case 'success':
      return {
        label: '成功',
        className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      };
    case 'error':
      return {
        label: '失败',
        className: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
      };
    case 'timeout':
      return {
        label: '超时',
        className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
      };
    case 'cancelled':
      return {
        label: '已取消',
        className: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
      };
    case 'rejected':
      return {
        label: '已拒绝',
        className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
      };
    case 'running':
    default:
      return {
        label: '进行中',
        className: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
        icon: <LoaderCircle className="h-3.5 w-3.5 animate-spin" />,
      };
  }
}

function buildToolOutputPreview(content: string) {
  const normalized = content.replace(/\s+$/g, '');
  if (normalized.length <= TOOL_OUTPUT_PREVIEW_LIMIT) {
    return {
      content: normalized,
      truncated: false,
    };
  }

  return {
    content: `${normalized.slice(0, TOOL_OUTPUT_PREVIEW_LIMIT)}\n...`,
    truncated: true,
  };
}

function ToolOutputBlock({
  label,
  content,
  tone,
}: {
  label: string;
  content: string;
  tone: 'default' | 'danger';
}) {
  const preview = buildToolOutputPreview(content);

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/70">
        {label}
      </div>
      <pre
        className={cn(
          'max-h-56 overflow-auto rounded-2xl border px-3 py-2.5 text-[12px] leading-5 shadow-sm whitespace-pre-wrap [overflow-wrap:anywhere]',
          tone === 'danger'
            ? 'border-rose-500/20 bg-rose-500/5 text-rose-950 dark:text-rose-100'
            : 'border-border/40 bg-muted/30 text-foreground/85'
        )}
      >
        {preview.content}
      </pre>
      {preview.truncated && (
        <div className="text-[11px] text-muted-foreground/70">
          输出较长，当前只展示前 {TOOL_OUTPUT_PREVIEW_LIMIT} 个字符。
        </div>
      )}
    </div>
  );
}

function ToolRunDetails({ toolRuns }: { toolRuns: PersistedOntologyAssistantToolRun[] }) {
  if (toolRuns.length === 0) {
    return null;
  }

  return (
    <div className="mb-5 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground/80">
        <Terminal className="h-3.5 w-3.5" />
        <span>本轮工具过程</span>
      </div>

      {toolRuns.map((toolRun, index) => {
        const statusMeta = formatToolRunStatus(toolRun);
        const hasStdout = hasVisibleText(toolRun.stdout);
        const hasStderr = hasVisibleText(toolRun.stderr);
        const hasOutput = hasStdout || hasStderr;

        return (
          <div
            key={toolRun.callId || `tool-run-${index}`}
            className="space-y-2 rounded-3xl border border-border/40 bg-card/80 p-3 shadow-sm"
          >
            <div className="rounded-2xl border border-border/40 bg-background/80 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white dark:bg-slate-200 dark:text-slate-900">
                  tool_call
                </span>
                <span className="text-[11px] text-muted-foreground">
                  第 {index + 1} 次调用
                </span>
              </div>
              <div className="rounded-2xl bg-muted/40 px-3 py-2 font-mono text-[12px] leading-5 text-foreground/90 [overflow-wrap:anywhere]">
                {toolRun.command || '等待工具参数...'}
              </div>
              {toolRun.cwd && (
                <div className="mt-2 text-[11px] text-muted-foreground/80 [overflow-wrap:anywhere]">
                  cwd: {toolRun.cwd}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border/40 bg-background/80 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white">
                  tool_result
                </span>
                <div
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
                    statusMeta.className
                  )}
                >
                  {statusMeta.icon}
                  <span>{statusMeta.label}</span>
                  {typeof toolRun.exitCode === 'number' && (
                    <span className="font-mono opacity-80">exit {toolRun.exitCode}</span>
                  )}
                  {typeof toolRun.durationMs === 'number' && (
                    <span className="font-mono opacity-80">{(toolRun.durationMs / 1000).toFixed(2)}s</span>
                  )}
                </div>
              </div>

              {hasStdout && (
                <ToolOutputBlock label="stdout" content={toolRun.stdout} tone="default" />
              )}
              {hasStderr && (
                <ToolOutputBlock label="stderr" content={toolRun.stderr} tone="danger" />
              )}
              {!hasOutput && (
                <div className="text-[12px] text-muted-foreground/80">
                  {toolRun.status === 'running' ? '工具正在运行，等待返回结果...' : '本次工具调用没有可展示的输出。'}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ToolCallBlock({
  block,
}: {
  block: Extract<PersistedOntologyAssistantContentBlock, { type: 'tool_call' }>;
}) {
  const isNer = block.toolName === 'ner';
  const isRe = block.toolName === 're';

  if (isNer || isRe) {
    return (
      <div className="relative overflow-hidden rounded-[28px] border border-border/30 bg-card/80 p-4 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.55)] backdrop-blur-sm">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.14),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(99,102,241,0.10),transparent_38%)]" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black tracking-[0.24em] uppercase text-white shadow-sm',
                  isNer ? 'bg-cyan-600' : 'bg-indigo-600',
                )}
              >
                {isNer ? <Eye className="h-3.5 w-3.5" /> : <GitCompareArrows className="h-3.5 w-3.5" />}
                {isNer ? '观察中' : '对比分析中'}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {block.createdAt ? new Date(block.createdAt).toLocaleTimeString([], { hour12: false }) : ''}
              </span>
            </div>
            <div className="max-w-[30rem] text-[13px] leading-6 text-foreground/80">
              {isNer
                ? '正在识别实体并把它们整理进图谱，右侧会同步出现可连接的节点。'
                : '正在对照实体关系与上下文，准备把对比结果连成一条可读的关系链。'}
            </div>
          </div>
          <div className={cn(
            'rounded-2xl border px-3 py-2 text-[11px] font-bold',
            isNer
              ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
              : 'border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
          )}>
            {isNer ? 'NER' : 'RE'}
          </div>
        </div>
        <div className="relative mt-4 rounded-2xl border border-dashed border-border/40 bg-background/60 px-4 py-3 text-[12px] leading-6 text-muted-foreground">
          {isNer ? '观察实体抽取过程，并等待节点落图。' : '观察关系对照过程，并等待关系落线。'}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/40 bg-card/80 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white dark:bg-slate-200 dark:text-slate-900">
          tool_call
        </span>
        <span className="text-[11px] text-muted-foreground">
          {block.createdAt ? new Date(block.createdAt).toLocaleTimeString([], { hour12: false }) : ''}
        </span>
      </div>
      <div className="rounded-2xl bg-muted/40 px-3 py-2 font-mono text-[12px] leading-5 text-foreground/90 [overflow-wrap:anywhere]">
        {block.command || '等待工具参数...'}
      </div>
      {hasVisibleText(block.reasoning) && (
        <div className="mt-2 text-[12px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          reason: {block.reasoning}
        </div>
      )}
    </div>
  );
}

function ToolResultBlock({
  block,
}: {
  block: Extract<PersistedOntologyAssistantContentBlock, { type: 'tool_result' }>;
}) {
  const isNer = block.toolName === 'ner';
  const isRe = block.toolName === 're';
  const statusMeta = formatToolRunStatus({
    callId: block.callId,
    command: block.command,
    status: block.status,
    stdout: block.stdout,
    stderr: block.stderr,
    exitCode: block.exitCode,
    cwd: block.cwd,
    durationMs: block.durationMs,
    truncated: false,
    startedAt: block.createdAt,
    finishedAt: block.finishedAt,
  });
  const hasStdout = hasVisibleText(block.stdout);
  const hasStderr = hasVisibleText(block.stderr);

  if (isNer || isRe) {
    return (
      <div className="rounded-[28px] border border-border/30 bg-card/80 p-4 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.55)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black tracking-[0.24em] uppercase text-white shadow-sm',
                isNer ? 'bg-cyan-600' : 'bg-indigo-600',
              )}
            >
              {isNer ? <Eye className="h-3.5 w-3.5" /> : <GitCompareArrows className="h-3.5 w-3.5" />}
              {isNer ? '观察完成' : '对比完成'}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {typeof block.durationMs === 'number' ? `${(block.durationMs / 1000).toFixed(2)}s` : '已结束'}
            </span>
          </div>
          <div
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
              statusMeta.className,
            )}
          >
            {statusMeta.icon}
            <span>{statusMeta.label}</span>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-border/40 bg-background/70 p-3">
            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/70">
              {isNer ? '抽取结果' : '关系对照'}
            </div>
            {hasStdout ? (
              <ToolOutputBlock label="stdout" content={block.stdout} tone="default" />
            ) : (
              <div className="text-[12px] text-muted-foreground/80">
                本次没有可直接渲染的结构化输出。
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-dashed border-border/40 bg-muted/20 p-3">
            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/70">
              图谱联动
            </div>
            <div className="space-y-2 text-[12px] leading-6 text-muted-foreground">
              <div>
                {isNer ? '左侧已转为观察卡，右侧图谱会追加新节点。' : '左侧已转为对比卡，右侧图谱会尝试连出关系线。'}
              </div>
              <div className="rounded-xl bg-background/70 px-3 py-2 text-foreground/80">
                {isNer ? '节点正在落图' : '关系正在成线'}
              </div>
            </div>
          </div>
        </div>
        {hasStderr && (
          <div className="mt-3">
            <ToolOutputBlock label="stderr" content={block.stderr} tone="danger" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/40 bg-card/80 p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white">
          tool_result
        </span>
        <div
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
            statusMeta.className
          )}
        >
          {statusMeta.icon}
          <span>{statusMeta.label}</span>
          {typeof block.exitCode === 'number' && (
            <span className="font-mono opacity-80">exit {block.exitCode}</span>
          )}
          {typeof block.durationMs === 'number' && (
            <span className="font-mono opacity-80">{(block.durationMs / 1000).toFixed(2)}s</span>
          )}
        </div>
      </div>

      {hasStdout && (
        <ToolOutputBlock label="stdout" content={block.stdout} tone="default" />
      )}
      {hasStderr && (
        <ToolOutputBlock label="stderr" content={block.stderr} tone="danger" />
      )}
      {!hasStdout && !hasStderr && (
        <div className="text-[12px] text-muted-foreground/80">
          本次工具调用没有可展示的输出。
        </div>
      )}
    </div>
  );
}

function MessageContentBlocks({
  blocks,
}: {
  blocks: PersistedOntologyAssistantContentBlock[];
}) {
  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {blocks.map((block) => {
        if (block.type === 'assistant') {
          if (!hasVisibleText(block.content)) {
            return null;
          }

          return (
            <div key={block.id} className="group/msg flex flex-col items-start">
              <div className="flex-1 min-w-0 w-full text-foreground/90">
                <AssistantMarkdown content={block.content} />
              </div>
              {block.phase === 'completed' && (
                <div className="mt-1 animate-in fade-in duration-500">
                  <MessageCopyButton content={block.content} />
                </div>
              )}
            </div>
          );
        }

        if (block.type === 'tool_call') {
          return <ToolCallBlock key={block.id} block={block} />;
        }

        if (block.type === 'tool_result') {
          return <ToolResultBlock key={block.id} block={block} />;
        }

        return null;
      })}
    </div>
  );
}

function MessageCopyButton({ content }: { content: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    await copyCodeToClipboard(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "opacity-0 group-hover/msg:opacity-100 transition-all p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground",
        copied && "opacity-100 text-green-500"
      )}
      title={copied ? "已复制" : "复制"}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export function ChatArea({
  activeSession,
  onAsk,
  onStop,
  onDraftChange,
  onUploadFile,
  isBusy,
  renderSettings,
  renderExtraActions
}: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showScrollButton, setShowScrollButton] = React.useState(false);
  const { messages, draftQuestion, loading, error, statusMessage } = activeSession;
  const lastMessage = messages[messages.length - 1];

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // Show button if we are more than one viewport away from bottom
      const isScrolledUp = scrollHeight - scrollTop - clientHeight > clientHeight;
      setShowScrollButton(isScrolledUp);
    }
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  // Auto-scroll logic
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, statusMessage]);

  // Auto-resize logic
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const newHeight = Math.min(textarea.scrollHeight, 200);
      textarea.style.height = `${newHeight}px`;
    }
  }, [draftQuestion]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isBusy) {
      e.preventDefault();
      onAsk();
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      await onUploadFile(file);
    } finally {
      event.target.value = '';
    }
  };

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground">
      {/* Floating Header for Settings/Flow Toggle */}
      <div className="absolute top-0 left-0 right-0 z-20 h-14 flex items-center justify-between px-6 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          {renderSettings?.()}
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          {renderExtraActions?.()}
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-smooth"
      >
        <div className="flex min-h-full flex-col justify-end">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 my-auto">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <Sparkles className="w-7 h-7" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-foreground/90">有什么可以帮你的？</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  可以询问关于本体知识库中任何概念、定义或关系的问题
                </p>
              </div>
            </div>
          )}

          <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 pt-16 pb-[55vh]">
            {messages.map((message: any, index: number) => {
              const prevMessage = index > 0 ? messages[index - 1] : null;
              const nextMessage = index < messages.length - 1 ? messages[index + 1] : null;
              const contentBlocks = Array.isArray(message.contentBlocks) ? message.contentBlocks : [];
              const toolRuns = Array.isArray(message.toolRuns) ? message.toolRuns : [];
              const hasAssistantAnswer = hasVisibleText(message.answer);
              const hasContentBlocks = contentBlocks.length > 0;
              const hasAssistantContent = hasContentBlocks || hasAssistantAnswer || toolRuns.length > 0;

              const isUserFollowUp = prevMessage && !prevMessage.answer;
              const hasConsecutiveUser = nextMessage && !message.answer;

              return (
                <React.Fragment key={message.id}>
                  {/* User Message */}
                  <div className={cn(
                    "group/msg flex flex-col items-end",
                    isUserFollowUp ? "mt-3" : (index === 0 ? "mt-0" : "mt-10")
                  )}>
                    <div className="bg-muted/50 dark:bg-muted/40 rounded-3xl px-5 py-3.5 text-[17px] leading-[1.6] text-foreground break-words [overflow-wrap:anywhere] max-w-[85%] border border-border/20 shadow-sm transition-colors">
                      {message.question}
                    </div>
                    {!hasConsecutiveUser && (
                      <div className="mt-1 px-1">
                        <MessageCopyButton content={message.question} />
                      </div>
                    )}
                  </div>

                  {/* Agent Message — Show answer and inline tool trace for the same round */}
                  {hasAssistantContent && (
                    <div className="group/msg flex flex-col items-start px-1 mt-8 transition-all">
                      <div className="flex-1 min-w-0 w-full text-foreground/90">
                        {hasContentBlocks ? (
                          <MessageContentBlocks blocks={contentBlocks} />
                        ) : (
                          <ToolRunDetails toolRuns={toolRuns} />
                        )}
                        {!hasContentBlocks && hasAssistantAnswer && (
                          <AssistantMarkdown content={message.answer} />
                        )}
                      </div>
                      {!hasContentBlocks && hasAssistantAnswer && (!loading || index < messages.length - 1) && (
                        <div className="mt-1 animate-in fade-in duration-500">
                          <MessageCopyButton content={message.answer} />
                        </div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* Status & Typing Indicator (GPT style pulsing dot) */}
            {loading && (statusMessage || (lastMessage && !lastMessage?.answer)) && (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 mt-6">
                <div className="flex items-center gap-2.5 px-1">
                  <div className="w-5 h-5 flex items-center justify-center">
                    <div className="w-2 bg-foreground rounded-full h-2 animate-pulse" />
                  </div>
                  {statusMessage && (
                    <span className="text-sm font-medium text-muted-foreground">{statusMessage}</span>
                  )}
                </div>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div className="flex items-center gap-3 p-4 rounded-xl border border-red-100 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10 text-red-600 dark:text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="break-words [overflow-wrap:anywhere] font-medium">{error}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 pointer-events-none">
        {/* Scroll to Bottom Button */}
        <div className="absolute bottom-[190px] left-1/2 -translate-x-1/2 z-30 flex justify-center pointer-events-auto">
          <Button
            size="icon"
            variant="outline"
            onClick={scrollToBottom}
            className={cn(
              "w-10 h-10 rounded-full bg-background/80 backdrop-blur-md border border-border shadow-xl transition-all duration-300 transform",
              showScrollButton ? "translate-y-0 opacity-100 scale-100" : "translate-y-4 opacity-0 scale-90"
            )}
          >
            <ArrowDown className="w-4 h-4 text-muted-foreground" />
          </Button>
        </div>

        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background via-background/80 to-transparent z-10" />
        <div className="relative w-full max-w-3xl mx-auto px-4 sm:px-6 pb-6 pt-0 text-center z-20">
          <div className="relative flex flex-col bg-background/95 backdrop-blur-xl rounded-[28px] border border-border p-1.5 shadow-2xl pointer-events-auto transition-all">
            {/* Input Row */}
            <div className="flex-1 w-full px-2">
              <Textarea
                ref={textareaRef}
                placeholder="有问必答..."
                value={draftQuestion}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full min-h-[32px] max-h-[200px] px-2 pt-2.5 pb-1 resize-none border-none bg-transparent dark:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-[17px] leading-[1.6] text-foreground placeholder:text-muted-foreground/50 shadow-none outline-none"
              />
            </div>

            {/* Toolbar Row */}
            <div className="flex items-center justify-end px-1">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(event) => {
                    void handleFileChange(event);
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-10 h-10 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                  title="上传文件到当前会话 runtime"
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  onClick={() => (loading ? onStop() : onAsk())}
                  disabled={(!loading && !draftQuestion.trim()) || isBusy && !loading}
                  className={cn(
                    "w-10 h-10 rounded-full transition-all active:scale-95 shadow-md",
                    loading
                      ? "bg-muted text-foreground hover:bg-muted/80"
                      : "bg-foreground hover:bg-foreground/90 text-background"
                  )}
                >
                  {loading ? <Square className="w-4 h-4 fill-slate-900" /> : <ArrowUp className="w-5 h-5" />}
                </Button>
              </div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground/60 italic tracking-wider">
            ENTER 发送 · SHIFT+ENTER 换行
          </div>
        </div>
      </div>
    </div>
  );
}
