import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  Bot,
  Check,
  Copy,
  Loader2,
  Pencil,
  Sparkles,
  User,
} from "lucide-react";

import { CitationInspector } from "./components/CitationInspector";
import { CommandPalette } from "./components/CommandPalette";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { GitHubReviewDialog } from "./components/GitHubReviewDialog";
import { GitHubReviewResultCard } from "./components/GitHubReviewResultCard";
import { GraphViewer } from "./components/GraphViewer";
import { IngestionPanel } from "./components/IngestionPanel";
import { Layout } from "./components/Layout";
import { Alert, AlertDescription } from "./components/ui/alert";
import {
  askQuestionStream,
  cancelQuestionStream,
  cancelGitHubReviewStream,
  reviewGitHubCodeStream,
  type GraphHit,
  type GitHubReviewPartialReport,
  type GitHubReviewRequest,
  type GitHubReviewResponse,
  type MessagePair,
  type QuestionAnswerResponse,
  type QuestionAnswerStreamContext,
  type RAGHit,
} from "./lib/api";
import {
  ACTIVE_CONVERSATION_STORAGE_KEY,
  CONVERSATIONS_STORAGE_KEY,
  type CitationDetail,
  type Conversation,
  type Message,
  createConversation,
  findCitationDetail,
  loadConversationState,
  parseAnswerText,
  sortConversations,
  updateConversationMessages,
} from "./lib/qa";

const EMPTY_RESPONSE: QuestionAnswerResponse = {
  answer: "",
  route_trace: [],
  source_results: [],
  evidence: {
    rag_hits: [],
    graph_hits: [],
    graph_paths: [],
  },
  warnings: [],
};

const THINKING_TEXT = "Thinking...";
const GITHUB_REVIEW_THINKING_TEXT = "正在审查 GitHub 仓库...";
const GITHUB_REVIEW_STOPPED_TEXT = "GitHub 代码审查已停止。";
const QA_STOPPED_TEXT = "已停止输出。";
const MAX_HISTORY_MESSAGES = 8;
const MAX_GITHUB_REVIEW_ISSUES = 5;

function App() {
  const [initialConversationState] = useState(() => loadConversationState());
  const [conversations, setConversations] = useState<Conversation[]>(
    initialConversationState.conversations,
  );
  const [activeConversationId, setActiveConversationId] = useState(
    initialConversationState.activeConversationId,
  );
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState("qa");
  const [selectedCitation, setSelectedCitation] = useState<CitationDetail | null>(null);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [isGitHubReviewDialogOpen, setIsGitHubReviewDialogOpen] = useState(false);
  const [githubReviewSubmitting, setGitHubReviewSubmitting] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamControllerRef = useRef<AbortController | null>(null);
  const githubReviewControllerRef = useRef<AbortController | null>(null);
  const streamingConversationIdRef = useRef<string | null>(null);
  const streamingRequestIdRef = useRef<string | null>(null);
  const githubReviewRequestIdRef = useRef<string | null>(null);

  const sortedConversations = useMemo(
    () => sortConversations(conversations),
    [conversations],
  );
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ??
    sortedConversations[0] ??
    null;
  const messages = useMemo(() => activeConversation?.messages ?? [], [activeConversation]);
  const inputBusy = loading || githubReviewSubmitting;

  useEffect(() => {
    localStorage.setItem(
      CONVERSATIONS_STORAGE_KEY,
      JSON.stringify(sortConversations(conversations)),
    );
    localStorage.setItem(
      ACTIVE_CONVERSATION_STORAGE_KEY,
      activeConversation?.id ?? activeConversationId,
    );
  }, [activeConversation, activeConversationId, conversations]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const lastMessage = messages[messages.length - 1];
    const isUserMessage = lastMessage?.role === "user";
    const isNearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 150;
    
    // Always scroll to bottom if it's a new user message or we are already near bottom
    if (isUserMessage || isNearBottom) {
      const timeout = window.setTimeout(() => {
        scrollEl.scrollTop = scrollEl.scrollHeight;
        setShowScrollButton(false);
      }, 50);
      return () => window.clearTimeout(timeout);
    }
  }, [messages, loading]);

  const handleScroll = () => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const isNearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 200;
    setShowScrollButton(!isNearBottom);
  };

  const deleteConversation = (id: string) => {
    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      if (filtered.length === 0) {
        const fallback = createConversation();
        setActiveConversationId(fallback.id);
        return [fallback];
      }
      if (id === activeConversationId) {
        setActiveConversationId(filtered[0]?.id || "");
      }
      return filtered;
    });
  };

  useEffect(() => {
    if (activeConversation) {
      return;
    }

    const fallback = createConversation();
    setConversations([fallback]);
    setActiveConversationId(fallback.id);
  }, [activeConversation]);

  useEffect(() => {
    return () => {
      const requestId = streamingRequestIdRef.current;
      if (requestId) {
        void cancelQuestionStream(requestId).catch(() => undefined);
      }
      streamControllerRef.current?.abort();
      githubReviewControllerRef.current?.abort();
    };
  }, []);

  const mergeContext = (
    current: QuestionAnswerResponse | null,
    context: QuestionAnswerStreamContext,
  ): QuestionAnswerResponse => ({
    answer: current?.answer ?? "",
    route_trace: context.route_trace,
    source_results: context.source_results,
    evidence: context.evidence,
    warnings: context.warnings,
  });

  const createNewConversation = () => {
    const nextConversation = createConversation();
    setConversations((prev) => sortConversations([nextConversation, ...prev]));
    setActiveConversationId(nextConversation.id);
    setSelectedCitation(null);
  };

  const selectConversation = (conversationId: string) => {
    setActiveConversationId(conversationId);
    setSelectedCitation(null);
  };

  const patchConversation = (
    conversationId: string,
    updater: (conversation: Conversation) => Conversation,
  ) => {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === conversationId ? updater(conversation) : conversation,
      ),
    );
  };

  const patchPendingAssistantMessage = (
    conversationId: string,
    updater: (message: Message) => Message,
  ) => {
    patchConversation(conversationId, (conversation) => {
      if (conversation.messages.length === 0) {
        return conversation;
      }

      const nextMessages = [...conversation.messages];
      const lastIndex = nextMessages.length - 1;
      const currentMessage = nextMessages[lastIndex];
      if (currentMessage.role !== "assistant") {
        return conversation;
      }

      nextMessages[lastIndex] = updater(currentMessage);
      return updateConversationMessages(conversation, nextMessages);
    });
  };

  const openGitHubReviewDialog = () => {
    setIsGitHubReviewDialogOpen(true);
  };

  const closeGitHubReviewDialog = () => {
    if (githubReviewSubmitting) {
      return;
    }

    setIsGitHubReviewDialogOpen(false);
  };

  const handleGitHubReviewSubmit = async (reviewRequest: GitHubReviewRequest) => {
    if (inputBusy) {
      return;
    }

    const requestSummary = formatGitHubReviewRequest(reviewRequest);
    const requestId = buildRequestId();

    const newUserMessage: Message = {
      role: "user",
      content: requestSummary,
      kind: "github_review",
    };
    const newAssistantMessage: Message = {
      role: "assistant",
      content: GITHUB_REVIEW_THINKING_TEXT,
      kind: "github_review",
      status: "正在准备 GitHub 代码审查...",
      githubReview: createEmptyGitHubReview(),
    };

    const targetConversation = activeConversation ?? createConversation();
    const seededConversation = updateConversationMessages(targetConversation, [
      ...targetConversation.messages,
      newUserMessage,
      newAssistantMessage,
    ]);
    const conversationId = seededConversation.id;

    if (!activeConversation) {
      setConversations((prev) => sortConversations([seededConversation, ...prev]));
      setActiveConversationId(conversationId);
    } else {
      patchConversation(conversationId, () => seededConversation);
    }

    setSelectedCitation(null);
    setIsGitHubReviewDialogOpen(false);
    setGitHubReviewSubmitting(true);
    
    const controller = new AbortController();
    githubReviewControllerRef.current = controller;
    streamingConversationIdRef.current = conversationId;
    githubReviewRequestIdRef.current = requestId;

    try {
      const response = await reviewGitHubCodeStream(
        {
          ...reviewRequest,
          request_id: requestId,
        },
        {
          onStatus: (message) => {
            patchPendingAssistantMessage(conversationId, (currentMessage) => ({
              ...currentMessage,
              kind: "github_review",
              status: message || "正在准备 GitHub 代码审查...",
              githubReview:
                currentMessage.githubReview ?? createEmptyGitHubReview("审查进行中。"),
            }));
          },
          onProgress: (progress) => {
            patchPendingAssistantMessage(conversationId, (currentMessage) => ({
              ...currentMessage,
              kind: "github_review",
              githubReviewProgress: progress,
              githubReview:
                currentMessage.githubReview ?? createEmptyGitHubReview("审查进行中。"),
            }));
          },
          onPartialReport: (partialReport) => {
            patchPendingAssistantMessage(conversationId, (currentMessage) => ({
              ...currentMessage,
              kind: "github_review",
              content: GITHUB_REVIEW_THINKING_TEXT,
              githubReview: mergeGitHubReviewPartial(currentMessage.githubReview, partialReport),
              status: currentMessage.status || "正在汇总发现...",
              error: undefined,
            }));
          },
          onComplete: (completed) => {
            patchPendingAssistantMessage(conversationId, (currentMessage) => ({
              ...currentMessage,
              content: completed.summary || "GitHub 代码审查已完成。",
              kind: "github_review",
              githubReview: completed,
              status: "",
              error: undefined,
            }));
          },
        },
        { signal: controller.signal },
      );
      patchPendingAssistantMessage(conversationId, (currentMessage) => ({
        ...currentMessage,
        content: response.summary || "GitHub 代码审查已完成。",
        kind: "github_review",
        githubReview: response,
        status: "",
        error: undefined,
      }));
    } catch (err: unknown) {
      if (isAbortError(err)) {
        finalizeStoppedStream(conversationId);
        return;
      }
      const detail = getErrorMessage(err, "GitHub 代码审查请求失败。");
      patchPendingAssistantMessage(conversationId, (currentMessage) => ({
        ...currentMessage,
        content: "GitHub 代码审查失败。",
        kind: "github_review",
        githubReview: currentMessage.githubReview ?? createEmptyGitHubReview("GitHub 代码审查失败。"),
        status: "",
        error: detail,
      }));
    } finally {
      githubReviewControllerRef.current = null;
      streamingConversationIdRef.current = null;
      githubReviewRequestIdRef.current = null;
      setGitHubReviewSubmitting(false);
    }
  };

  const finalizeStoppedStream = (conversationId: string) => {
    patchPendingAssistantMessage(conversationId, (currentMessage) => {
      if (currentMessage.content === THINKING_TEXT) {
        return {
          ...currentMessage,
          content: QA_STOPPED_TEXT,
          status: "",
          error: undefined,
        };
      }

      if ((currentMessage as Message).kind === "github_review") {
        return {
          ...currentMessage,
          content: GITHUB_REVIEW_STOPPED_TEXT,
          status: "",
          error: undefined,
        };
      }

      if (currentMessage.content === THINKING_TEXT) {
        return {
          ...currentMessage,
          content: "已停止输出。",
          status: "",
          error: undefined,
        };
      }

      if (currentMessage.kind === "github_review") {
        return {
          ...currentMessage,
          content: "代码检查已中止。",
          status: "",
          error: undefined,
        };
      }

      return {
        ...currentMessage,
        status: "",
        error: undefined,
      };
    });
  };

  const handleStopStreaming = () => {
    const requestId = streamingRequestIdRef.current;
    const reviewRequestId = githubReviewRequestIdRef.current;
    const conversationId = streamingConversationIdRef.current;
    if (requestId) {
      void cancelQuestionStream(requestId).catch(() => undefined);
    }
    if (reviewRequestId) {
      void cancelGitHubReviewStream(reviewRequestId).catch(() => undefined);
    }
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;
    githubReviewControllerRef.current?.abort();
    githubReviewControllerRef.current = null;
    streamingConversationIdRef.current = null;
    streamingRequestIdRef.current = null;
    githubReviewRequestIdRef.current = null;
    setLoading(false);
    setGitHubReviewSubmitting(false);
    if (conversationId) {
      finalizeStoppedStream(conversationId);
    }
  };

  const handleSubmit = async (query: string, overrideMessages?: Message[]) => {
    if (!query.trim()) {
      return;
    }

    if (inputBusy) {
      return;
    }

    const targetConversation = activeConversation ?? createConversation();
    const baseMessages = overrideMessages ?? targetConversation.messages;
    const preparedRequest = prepareQuestionRequest(query, baseMessages);
    const effectiveQuery = preparedRequest.question;
    const effectiveBaseMessages = preparedRequest.baseMessages;
    const history = preparedRequest.history;
    const newUserMessage: Message = { role: "user", content: effectiveQuery };
    const newAssistantMessage: Message = { role: "assistant", content: THINKING_TEXT };

    const seededConversation = updateConversationMessages(targetConversation, [
      ...effectiveBaseMessages,
      newUserMessage,
      newAssistantMessage,
    ]);
    const conversationId = seededConversation.id;

    if (!activeConversation || overrideMessages) {
      setConversations((prev) => {
        const exists = prev.find(c => c.id === conversationId);
        if (exists) {
          return prev.map(c => c.id === conversationId ? seededConversation : c);
        }
        return [seededConversation, ...prev];
      });
      setActiveConversationId(conversationId);
    } else {
      patchConversation(conversationId, () => seededConversation);
    }

    setLoading(true);
    const controller = new AbortController();
    const requestId = buildRequestId();
    streamControllerRef.current = controller;
    streamingConversationIdRef.current = conversationId;
    streamingRequestIdRef.current = requestId;

    try {
      let updatedResponse: QuestionAnswerResponse = { ...EMPTY_RESPONSE };

      await askQuestionStream(
        { question: effectiveQuery, request_id: requestId, history },
        {
          onStatus: (message) => {
            patchPendingAssistantMessage(conversationId, (currentMessage) => ({
              ...currentMessage,
              status: message || THINKING_TEXT,
            }));
          },
          onContext: (context) => {
            updatedResponse = mergeContext(updatedResponse, context);
            patchPendingAssistantMessage(conversationId, (currentMessage) => ({
              ...currentMessage,
              response: updatedResponse,
            }));
          },
          onAnswerDelta: (delta) => {
            patchPendingAssistantMessage(conversationId, (currentMessage) => {
              const currentContent =
                currentMessage.content === THINKING_TEXT ? "" : currentMessage.content;
              return {
                ...currentMessage,
                content: currentContent + delta,
                status: "",
              };
            });
          },
          onComplete: (completed) => {
            patchPendingAssistantMessage(conversationId, (currentMessage) => ({
              ...currentMessage,
              content: completed.answer,
              response: completed,
              status: "",
            }));
          },
        },
        { signal: controller.signal },
      );
    } catch (err: unknown) {
      if (isAbortError(err)) {
        finalizeStoppedStream(conversationId);
        return;
      }

      let detail = "Unknown error";
      
      if (err && typeof err === "object" && "response" in err) {
        const axErr = err as { response?: { data?: { message?: string } } };
        detail = axErr.response?.data?.message || "Streaming request failed.";
      } else if (err instanceof Error) {
        detail = err.message;
      } else if (typeof err === "string") {
        detail = err;
      }

      patchPendingAssistantMessage(conversationId, (currentMessage) => ({
        ...currentMessage,
        error: detail,
        content: "Answer generation failed.",
      }));
    } finally {
      streamControllerRef.current = null;
      streamingConversationIdRef.current = null;
      streamingRequestIdRef.current = null;
      setLoading(false);
    }
  };

  const handleEditSubmit = async (index: number) => {
    if (!editingContent.trim() || !activeConversation) return;

    const newQuery = editingContent.trim();
    // Keep messages before the one being edited
    const prunedMessages = activeConversation.messages.slice(0, index);

    setEditingMessageIndex(null);
    setEditingContent("");
    
    // Trigger handleSubmit with both the new query and the pruned message list
    await handleSubmit(newQuery, prunedMessages);
  };

  return (
    <Layout currentPage={currentPage} onPageChange={setCurrentPage}>
      {currentPage === "qa" && (
        <div className="flex h-full min-h-0 overflow-hidden">
          <ConversationSidebar
            conversations={sortedConversations}
            activeConversationId={activeConversation?.id ?? activeConversationId}
            onCreateConversation={createNewConversation}
            onSelectConversation={selectConversation}
            onDeleteConversation={deleteConversation}
          />

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="border-b bg-white/70 px-5 py-4 backdrop-blur dark:bg-zinc-950/70">
              <div className="flex items-center gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Active conversation
                  </div>
                  <div className="mt-1 truncate text-lg font-semibold">
                    {activeConversation?.title ?? "New chat"}
                  </div>
                </div>
              </div>

            </div>

            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              {messages.length === 0 && (
                <div className="flex flex-1 flex-col items-center justify-center space-y-6 px-8 pb-12 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 shadow-inner">
                    <Sparkles className="h-8 w-8 text-primary" />
                  </div>
                  <div className="space-y-3">
                    <h2 className="bg-gradient-to-br from-zinc-900 to-zinc-500 bg-clip-text pb-1 text-3xl font-bold tracking-tight text-transparent dark:from-zinc-50 dark:to-zinc-400">
                      Welcome to Ontology+Agent+RAG for TEST
                    </h2>
                    <p className="max-w-xl text-sm leading-7 text-muted-foreground">
                      Ask a question, start a fresh conversation, and inspect mixed RAG plus graph citations directly from the answer.
                    </p>
                  </div>
                </div>
              )}

              {messages.length > 0 && (
                <div
                  ref={scrollRef}
                  onScroll={handleScroll}
                  className="flex-1 overflow-y-auto overflow-x-hidden px-4 pb-60 pt-6 md:px-8"
                >
                  <div className="mx-auto max-w-4xl space-y-12">
                    {messages.map((message, index) => (
                      <div
                        key={`${message.role}-${index}-${message.content.slice(0, 16)}`}
                        className={`flex w-full flex-col gap-4 ${
                          message.role === "assistant" ? "items-start" : "items-end"
                        }`}
                      >
                        {message.role === "user" ? (
                          <div className="flex w-full max-w-[90%] items-start gap-3 ml-auto flex-row-reverse">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-white shadow-sm dark:bg-zinc-800 mt-0.5">
                              <User className="h-4 w-4" />
                            </div>
                            <div className="group flex flex-col items-end gap-1.5 flex-1 min-w-0">
                              {editingMessageIndex === index ? (
                                <div className="w-full space-y-2">
                                  <textarea
                                    className="w-full rounded-2xl border bg-white dark:bg-zinc-900 p-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none min-h-[100px]"
                                    value={editingContent}
                                    onChange={(e) => setEditingContent(e.target.value)}
                                    autoFocus
                                  />
                                  <div className="flex justify-end gap-2">
                                    <button
                                      onClick={() => {
                                        setEditingMessageIndex(null);
                                        setEditingContent("");
                                      }}
                                      className="px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={() => handleEditSubmit(index)}
                                      disabled={!editingContent.trim() || inputBusy}
                                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                    >
                                      Send
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="whitespace-pre-wrap rounded-2xl bg-primary px-5 py-3 text-[15px] leading-relaxed text-primary-foreground shadow-sm">
                                    {message.content}
                                  </div>
                                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity pr-1">
                                    <button
                                      onClick={() => {
                                        setEditingMessageIndex(index);
                                        setEditingContent(message.content);
                                      }}
                                      className="h-6 px-2 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-all duration-200"
                                      title="Edit message"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </button>
                                    <CopyButton content={message.content} variant="ghost" className="h-6 px-2 text-[10px] gap-1.5 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800" />
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="flex w-full max-w-[90%] items-start gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm mt-0.5">
                              <Bot className="h-4 w-4" />
                            </div>
                            <div className="group flex flex-col items-start gap-1.5 flex-1 min-w-0">
                              {message.kind === "github_review" ? (
                                message.githubReview ||
                                message.githubReviewProgress ||
                                message.content !== GITHUB_REVIEW_THINKING_TEXT ? (
                                  <GitHubReviewResultCard
                                    review={
                                      message.githubReview ??
                                      buildFallbackGitHubReview(message.content)
                                    }
                                    progress={message.githubReviewProgress}
                                    isStreaming={
                                      Boolean(githubReviewSubmitting) &&
                                      message.content !== GITHUB_REVIEW_STOPPED_TEXT
                                    }
                                  />
                                ) : (
                                  <div className="inline-flex rounded-2xl border-none bg-zinc-100/50 px-6 py-4 text-[15px] leading-relaxed shadow-sm dark:bg-zinc-800/30">
                                    <span className="flex items-center gap-2 italic text-muted-foreground">
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      {message.status || GITHUB_REVIEW_THINKING_TEXT}
                                    </span>
                                  </div>
                                )
                              ) : (
                                <div
                                  className={`rounded-2xl px-6 py-4 text-[15px] leading-relaxed shadow-sm ${
                                    message.content === THINKING_TEXT
                                      ? "inline-flex border-none bg-zinc-100/50 dark:bg-zinc-800/30"
                                      : "border bg-white text-foreground dark:bg-zinc-900"
                                  }`}
                                >
                                  {message.content === THINKING_TEXT ? (
                                    <span className="flex items-center gap-2 italic text-muted-foreground">
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      {message.status || THINKING_TEXT}
                                    </span>
                                  ) : (
                                    <AnswerContent
                                      text={message.content}
                                      ragHits={message.response?.evidence?.rag_hits ?? []}
                                      graphHits={message.response?.evidence?.graph_hits ?? []}
                                      onSelectCitation={setSelectedCitation}
                                      isStreaming={loading && index === messages.length - 1}
                                    />
                                  )}
                                </div>
                              )}
                              
                              {message.kind !== "github_review" && message.content !== THINKING_TEXT && (
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity pl-1">
                                  <CopyButton content={message.content} variant="ghost" className="h-6 px-2 text-[10px] gap-1.5 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800" />
                                </div>
                              )}

                              {message.error && (
                                <Alert variant="destructive" className="mt-2 py-2 text-xs">
                                  <AlertCircle className="h-3 w-3" />
                                  <AlertDescription>{message.error}</AlertDescription>
                                </Alert>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {showScrollButton && (
                <button
                  onClick={() => {
                    if (scrollRef.current) {
                      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                    }
                  }}
                  className="absolute bottom-40 left-1/2 -translate-x-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800/80 text-white shadow-xl backdrop-blur transition-all hover:bg-zinc-900 hover:scale-110 active:scale-95 dark:bg-zinc-100/10 z-20"
                >
                  <ArrowDown className="h-5 w-5" />
                </button>
              )}

              <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-zinc-50 via-zinc-50/90 to-transparent px-4 pt-6 dark:from-zinc-950 dark:via-zinc-950/90 md:px-8">
                <div className="pointer-events-auto mx-auto flex max-w-4xl flex-col gap-3 pb-8">
                  <CommandPalette
                    onSubmit={handleSubmit}
                    onStop={handleStopStreaming}
                    isLoading={loading}
                    isGitHubReviewing={githubReviewSubmitting}
                    onOpenGitHubReview={openGitHubReviewDialog}
                  />
                </div>
              </div>
              <GitHubReviewDialog
                open={isGitHubReviewDialogOpen}
                onOpenChange={(open) => {
                  if (open) {
                    openGitHubReviewDialog();
                    return;
                  }
                  closeGitHubReviewDialog();
                }}
                onSubmit={handleGitHubReviewSubmit}
                isSubmitting={githubReviewSubmitting}
              />
            </div>
          </div>

          {selectedCitation && (
            <CitationInspector
              detail={selectedCitation}
              onClose={() => setSelectedCitation(null)}
            />
          )}
        </div>
      )}

      {currentPage === "ingest" && <IngestionPanel />}
      {currentPage === "graph" && <GraphViewer />}
    </Layout>
  );
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error && error.name === "AbortError"
  );
}

interface PreparedQuestionRequest {
  question: string;
  history: MessagePair[];
  baseMessages: Message[];
}

interface AssistantRetryCandidate {
  userIndex: number;
  userContent: string;
}

function prepareQuestionRequest(query: string, messages: Message[]): PreparedQuestionRequest {
  const normalizedQuery = query.trim();
  const retryCandidate = detectAssistantEchoRetry(messages, normalizedQuery);
  const baseMessages = retryCandidate ? messages.slice(0, retryCandidate.userIndex) : messages;
  const question = retryCandidate?.userContent ?? normalizedQuery;

  if (retryCandidate) {
    console.warn("Recovered QA payload from an assistant-echo question.", {
      repairedQuestion: question,
      droppedTurnCount: messages.length - baseMessages.length,
    });
  }

  return {
    question,
    history: buildHistoryPayload(baseMessages),
    baseMessages,
  };
}

function detectAssistantEchoRetry(messages: Message[], normalizedQuery: string): AssistantRetryCandidate | null {
  if (!normalizedQuery) {
    return null;
  }

  let assistantIndex = -1;
  let userIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isHistoryEligibleMessage(message)) {
      continue;
    }

    if (assistantIndex === -1) {
      if (message.role !== "assistant") {
        return null;
      }
      assistantIndex = index;
      continue;
    }

    if (message.role === "user") {
      userIndex = index;
    }
    break;
  }

  if (assistantIndex === -1 || userIndex === -1) {
    return null;
  }

  const assistantContent = messages[assistantIndex]?.content.trim() ?? "";
  const userContent = messages[userIndex]?.content.trim() ?? "";

  if (!assistantContent || !userContent) {
    return null;
  }

  if (normalizedQuery !== assistantContent) {
    return null;
  }

  if (normalizedQuery === userContent) {
    return null;
  }

  if (normalizedQuery.length > 40) {
    return null;
  }

  if (userContent.length < Math.max(20, normalizedQuery.length * 2)) {
    return null;
  }

  return { userIndex, userContent };
}

function buildRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `qa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildHistoryPayload(messages: Message[]): MessagePair[] {
  return messages
    .filter(isHistoryEligibleMessage)
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));
}

function isHistoryEligibleMessage(message: Message): boolean {
  const content = message.content.trim();
  if (!content || content === THINKING_TEXT || message.kind === "github_review") {
    return false;
  }
  if (
    message.role === "assistant" &&
    message.error &&
    !message.response &&
    content === "Answer generation failed."
  ) {
    return false;
  }
  return true;
}

function createEmptyGitHubReview(summary = "GitHub 代码审查进行中。"): GitHubReviewResponse {
  return {
    summary,
    issues: [],
    reviewed_files: [],
    warnings: [],
    next_steps: [],
  };
}

function mergeGitHubReviewResponse(
  current: GitHubReviewResponse | undefined,
  next: Partial<GitHubReviewResponse>,
): GitHubReviewResponse {
  const mergedIssues = limitGitHubReviewIssues([...(current?.issues ?? []), ...(next.issues ?? [])]);
  const mergedReviewedFiles = dedupeStrings([...(current?.reviewed_files ?? []), ...(next.reviewed_files ?? [])]);
  const mergedWarnings = dedupeStrings([...(current?.warnings ?? []), ...(next.warnings ?? [])]);
  const mergedNextSteps = dedupeStrings([...(current?.next_steps ?? []), ...(next.next_steps ?? [])]);

  return {
    summary: (next.summary ?? current?.summary ?? "GitHub 代码审查进行中。").trim(),
    issues: mergedIssues,
    reviewed_files: mergedReviewedFiles,
    warnings: mergedWarnings,
    next_steps: mergedNextSteps,
  };
}

function mergeGitHubReviewPartial(
  current: GitHubReviewResponse | undefined,
  partial: GitHubReviewPartialReport,
): GitHubReviewResponse {
  return mergeGitHubReviewResponse(current, {
    summary: current?.summary ?? `正在审查${formatGitHubReviewCategory(partial.category)}...`,
    issues: partial.issues,
    reviewed_files: partial.reviewed_files,
    warnings: partial.warnings,
    next_steps: [],
  });
}

function dedupeGitHubReviewIssues(issues: GitHubReviewResponse["issues"]): GitHubReviewResponse["issues"] {
  const seen = new Set<string>();
  const deduped: GitHubReviewResponse["issues"] = [];
  for (const issue of issues) {
    const key = [
      issue.category ?? "",
      issue.severity ?? "",
      issue.file_path ?? "",
      issue.line ?? "",
      issue.title ?? "",
      issue.summary ?? "",
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(issue);
  }
  return deduped;
}

function severityRank(severity: string | undefined): number {
  const norm = (severity || "").trim().toLowerCase();
  switch (norm) {
    case "critical":
    case "严重":
      return 0;
    case "high":
    case "高":
      return 1;
    case "medium":
    case "中":
      return 2;
    case "low":
    case "低":
      return 3;
    case "info":
    case "提示":
      return 4;
    default:
      return 99;
  }
}

function sortGitHubReviewIssues(
  issues: GitHubReviewResponse["issues"],
): GitHubReviewResponse["issues"] {
  return [...issues].sort((left, right) => {
    const severityDelta = severityRank(left.severity) - severityRank(right.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }
    const fileDelta = (left.file_path || "").localeCompare(right.file_path || "");
    if (fileDelta !== 0) {
      return fileDelta;
    }
    const leftLine = typeof left.line === "number" ? left.line : Number.MAX_SAFE_INTEGER;
    const rightLine = typeof right.line === "number" ? right.line : Number.MAX_SAFE_INTEGER;
    if (leftLine !== rightLine) {
      return leftLine - rightLine;
    }
    return (left.title || "").localeCompare(right.title || "");
  });
}

function limitGitHubReviewIssues(
  issues: GitHubReviewResponse["issues"],
): GitHubReviewResponse["issues"] {
  return sortGitHubReviewIssues(dedupeGitHubReviewIssues(issues)).slice(0, MAX_GITHUB_REVIEW_ISSUES);
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function formatGitHubReviewRequest(request: GitHubReviewRequest): string {
  const paths =
    request.paths.length <= 4
      ? request.paths
      : [...request.paths.slice(0, 3), `另 ${request.paths.length - 3} 项`];
  return [
    "GitHub 代码审查请求",
    `仓库：${request.repository_url}`,
    `版本：${request.ref}`,
    `路径：${paths.join("，")}`,
  ].join("\n");
}

function buildFallbackGitHubReview(summary: string): GitHubReviewResponse {
  return {
    summary: summary || "GitHub 代码审查已完成。",
    issues: [],
    reviewed_files: [],
    warnings: [],
    next_steps: [],
  };
}

function formatGitHubReviewCategory(category?: string): string {
  switch ((category || "").trim()) {
    case "correctness":
      return "正确性";
    case "risk_regression":
      return "回归风险";
    case "security":
      return "安全";
    case "test_coverage":
      return "测试覆盖";
    default:
      return "GitHub 文件";
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "response" in error) {
    const axErr = error as { response?: { data?: { message?: string } } };
    return axErr.response?.data?.message || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

function AnswerContent({
  text,
  ragHits,
  graphHits,
  onSelectCitation,
  isStreaming = false,
}: {
  text: string;
  ragHits: RAGHit[];
  graphHits: GraphHit[];
  onSelectCitation: (detail: CitationDetail) => void;
  isStreaming?: boolean;
}) {
  const parts = useMemo(() => parseAnswerText(text), [text]);
  const visibleCitationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const part of parts) {
      if (part.type === "citation") {
        ids.add(part.citationId);
      }
    }
    return ids;
  }, [parts]);
  const fallbackCitationDetails = useMemo(
    () => buildFallbackCitationDetails(visibleCitationIds, ragHits, graphHits),
    [visibleCitationIds, ragHits, graphHits],
  );

  return (
    <div className="whitespace-pre-wrap leading-relaxed">
      {parts.map((part) => {
        if (part.type === "text") {
          return <span key={part.key}>{part.value}</span>;
        }

        const detail = findCitationDetail(part.citationId, ragHits, graphHits);
        if (!detail) {
          return (
            <span
              key={part.key}
              className="ml-0.5 inline-flex rounded-md bg-primary/5 px-1.5 py-0.5 align-super text-[10px] font-bold text-primary"
            >
              [{part.citationId}]
            </span>
          );
        }

        return (
          <button
            key={part.key}
            type="button"
            onClick={() => onSelectCitation(detail)}
            className={`ml-1 mr-0.5 inline-flex rounded-md border border-primary/20 bg-primary/5 px-1.5 py-0.5 align-super text-[11px] font-bold text-primary transition-all duration-700 ${
              isStreaming ? "pointer-events-none translate-y-1 opacity-0" : "translate-y-0 opacity-100"
            } hover:border-primary/40 hover:bg-primary/10`}
          >
            [{part.citationId}]
          </button>
        );
      })}
      {fallbackCitationDetails.length > 0 && !isStreaming && (
        <span className="ml-1 inline-flex flex-wrap items-center gap-1 align-middle animate-in fade-in duration-700">
          {fallbackCitationDetails.map((detail) => (
            <button
              key={`fallback-${detail.citationId}`}
              type="button"
              onClick={() => onSelectCitation(detail)}
              className="inline-flex rounded-md border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[11px] font-bold text-primary transition-colors hover:border-primary/40 hover:bg-primary/10"
            >
              [{detail.citationId}]
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

function buildFallbackCitationDetails(
  visibleCitationIds: Set<string>,
  ragHits: RAGHit[],
  graphHits: GraphHit[],
): CitationDetail[] {
  const remainingIds = new Set(visibleCitationIds);
  const details: CitationDetail[] = [];
  for (const hit of ragHits) {
    const detail = hit.citation_id ? findCitationDetail(hit.citation_id, ragHits, graphHits) : null;
    if (!detail || remainingIds.has(detail.citationId)) {
      continue;
    }
    remainingIds.add(detail.citationId);
    details.push(detail);
  }
  for (const hit of graphHits) {
    const detail = hit.citation_id ? findCitationDetail(hit.citation_id, ragHits, graphHits) : null;
    if (!detail || remainingIds.has(detail.citationId)) {
      continue;
    }
    remainingIds.add(detail.citationId);
    details.push(detail);
  }
  return details;
}

function CopyButton({
  content,
  variant = "outline",
  className,
}: {
  content: string;
  variant?: "outline" | "ghost";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`flex items-center justify-center rounded-lg transition-all duration-200 ${
        variant === "ghost" 
          ? "hover:bg-zinc-100 dark:hover:bg-zinc-800" 
          : "border bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800 shadow-sm"
      } ${className || "h-8 w-8 px-0"}`}
      title="Copy message"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-500 animate-in zoom-in duration-300" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  );
}

export default App;
