import { AlertCircle, AlertTriangle, CheckCircle2, FileCode2, Info, Loader2 } from "lucide-react";

import type { GitHubReviewProgress } from "@/lib/api";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export interface GitHubReviewIssue {
  title: string;
  severity: string;
  file_path: string;
  line: number | null;
  summary: string;
  evidence: string;
  recommendation: string;
  category?: string;
}

export interface GitHubReviewResponse {
  summary: string;
  issues: GitHubReviewIssue[];
  reviewed_files: string[];
  warnings: string[];
  next_steps: string[];
}

export interface GitHubReviewResultCardProps {
  review: GitHubReviewResponse;
  progress?: GitHubReviewProgress;
  isStreaming?: boolean;
}

const SEVERITY_LABELS: Record<string, string> = {
  critical: "严重",
  high: "高",
  medium: "中",
  low: "低",
  info: "提示",
};

const PHASE_LABELS: Record<string, string> = {
  queued: "排队中",
  validate_request: "校验请求",
  resolve_github_target: "解析仓库目标",
  download_repository_snapshot: "下载仓库快照",
  discover_candidate_files: "发现候选文件",
  build_scope_packet: "构建范围包",
  scope_planner: "规划审查范围",
  select_focus_files: "选择焦点文件",
  correctness: "正确性审查",
  risk_regression: "回归风险审查",
  security: "安全审查",
  test_coverage: "测试覆盖审查",
  local_merge_and_finalize: "汇总结果",
};

function getSeverityTone(severity: string) {
  const normalized = severity.trim().toLowerCase();
  const label = SEVERITY_LABELS[normalized] || normalized || "提示";
  if (normalized === "critical" || normalized === "high") {
    return {
      icon: <AlertCircle className="h-4 w-4 text-destructive" />,
      border: "border-l-destructive",
      badge: "destructive" as const,
      label,
    };
  }
  if (normalized === "medium") {
    return {
      icon: <AlertTriangle className="h-4 w-4 text-amber-500" />,
      border: "border-l-amber-500",
      badge: "secondary" as const,
      label,
    };
  }
  if (normalized === "low" || normalized === "info") {
    return {
      icon: <Info className="h-4 w-4 text-sky-500" />,
      border: "border-l-sky-500",
      badge: "outline" as const,
      label,
    };
  }
  return {
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
    border: "border-l-emerald-500",
    badge: "outline" as const,
    label,
  };
}


function asListItem(value: string | undefined | null): string {
  return (value ?? "").trim();
}

function formatProgress(progress?: GitHubReviewProgress): string {
  if (!progress) {
    return "";
  }

  const total = progress.total_phases > 0 ? progress.total_phases : 0;
  const completed = Math.min(Math.max(progress.completed_phases, 0), total || progress.completed_phases);
  const phaseKey = progress.phase?.trim() || "";
  const phaseLabel = PHASE_LABELS[phaseKey] || phaseKey || "处理中";
  if (total <= 0) {
    return phaseLabel;
  }

  return `${phaseLabel} ${completed}/${total}`;
}

export function GitHubReviewResultCard({
  review,
  progress,
  isStreaming = false,
}: GitHubReviewResultCardProps) {
  const issues = review.issues ?? [];
  const warnings = (review.warnings ?? []).map(asListItem).filter(Boolean);
  const reviewedFiles = (review.reviewed_files ?? []).map(asListItem).filter(Boolean);
  const nextSteps = (review.next_steps ?? []).map(asListItem).filter(Boolean);
  const summary = review.summary?.trim() || "未返回摘要。";
  const progressLabel = formatProgress(progress);
  const progressTotal = progress?.total_phases ?? 0;
  const progressCompleted = progress ? Math.min(progress.completed_phases, progressTotal || progress.completed_phases) : 0;
  const progressPercent =
    progress && progressTotal > 0
      ? Math.max(5, Math.min(100, Math.round((progressCompleted / progressTotal) * 100)))
      : 0;

  return (
    <Card className="w-full overflow-hidden border-zinc-200/70 shadow-lg dark:border-zinc-800/50">
      <CardHeader className="border-b bg-zinc-50/50 px-6 py-5 dark:bg-zinc-900/20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-primary/80">
              <FileCode2 className="h-3.5 w-3.5" />
              GitHub 代码审查
            </div>
            <CardTitle className="text-xl font-bold tracking-tight">结构化审查报告</CardTitle>
            <CardDescription className="flex items-center gap-2 text-sm">
              {issues.length > 0 ? (
                <span className="flex items-center gap-1.5 font-medium text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  发现 {issues.length} 个潜在问题
                </span>
              ) : (
                <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  未报告阻断性问题
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge
              variant={
                issues.some((issue) => {
                  const severity = issue.severity.trim().toLowerCase();
                  return severity === "critical" || severity === "high";
                })
                  ? "destructive"
                  : "outline"
              }
              className="px-3 py-1 text-xs font-bold"
            >
              {issues.length} 条发现
            </Badge>
            {isStreaming && (
              <Badge variant="secondary" className="animate-pulse px-2 py-0.5 text-[10px] font-bold">
                实时流式中
              </Badge>
            )}
          </div>
        </div>

        {(isStreaming || progressLabel) && (
          <div className="mt-6 space-y-3 rounded-xl border bg-white/50 p-4 dark:bg-zinc-950/30">
            <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="flex items-center gap-2">
                {!isStreaming && progressPercent === 100 ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {isStreaming ? `当前阶段：${progressLabel || "正在准备审查"}` : "审查已全部完成"}
              </span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/50 dark:bg-zinc-800/50">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary via-blue-500 to-emerald-500 transition-all duration-500"
                style={{ width: `${progressPercent || (isStreaming ? 10 : 0)}%` }}
              />
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        <section className="space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground/80">
            总览摘要
          </div>
          <div className="max-h-[200px] overflow-y-auto rounded-xl border bg-zinc-50/30 p-4 leading-relaxed dark:bg-zinc-950/20">
            <p className="whitespace-pre-wrap text-sm text-foreground/90">{summary}</p>
          </div>
        </section>

        {issues.length > 0 && (
          <section className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              问题
            </div>
            <div className="space-y-3">
              {issues.map((issue, index) => {
                const tone = getSeverityTone(issue.severity);
                return (
                  <div
                    key={`${issue.file_path}-${issue.line ?? "na"}-${issue.title}-${index}`}
                    className={`rounded-xl border bg-background/50 p-5 transition-colors hover:bg-background ${tone.border} border-l-4`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-1">{tone.icon}</div>
                        <div className="space-y-1.5">
                          <div className="text-[15px] font-bold tracking-tight text-foreground">
                            {issue.title}
                          </div>
                          <div className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            <span className="font-mono">{issue.file_path}</span>
                            {issue.line && (
                              <>
                                <span className="opacity-30">|</span>
                                <span className="text-primary/80">L{issue.line}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <Badge variant={tone.badge} className="uppercase tracking-wider">
                        {tone.label}
                      </Badge>
                    </div>

                    <div className="mt-4 space-y-3 text-sm leading-6 text-foreground">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          摘要
                        </div>
                        <p className="mt-1 whitespace-pre-wrap">{issue.summary}</p>
                      </div>

                      {issue.evidence?.trim() && (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            证据
                          </div>
                          <pre className="mt-1 overflow-x-auto rounded-lg bg-zinc-950 px-3 py-2 text-xs leading-5 text-zinc-100 dark:bg-zinc-900">
                            {issue.evidence.trim()}
                          </pre>
                        </div>
                      )}

                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          建议
                        </div>
                        <p className="mt-1 whitespace-pre-wrap">{issue.recommendation}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {reviewedFiles.length > 0 && (
          <section className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground/80">
              已审查文件 ({reviewedFiles.length})
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {reviewedFiles.map((file) => (
                <div
                  key={file}
                  className="flex items-center gap-2 rounded-lg border bg-zinc-50/50 px-3 py-2 text-xs transition-colors hover:bg-zinc-100 dark:bg-zinc-900/30 dark:hover:bg-zinc-800"
                >
                  <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span className="truncate font-mono opacity-80">{file}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {warnings.length > 0 && (
          <section className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              警告
            </div>
            <div className="space-y-2">
              {warnings.map((warning) => (
                <div
                  key={warning}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100"
                >
                  {warning}
                </div>
              ))}
            </div>
          </section>
        )}

        {nextSteps.length > 0 && (
          <section className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              后续建议
            </div>
            <ul className="space-y-2 text-sm leading-6 text-foreground">
              {nextSteps.map((step, index) => (
                <li key={`${index}-${step}`} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span className="whitespace-pre-wrap">{step}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
