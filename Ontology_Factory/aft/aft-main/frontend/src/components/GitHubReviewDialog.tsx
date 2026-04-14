import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { GitHubReviewRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export interface GitHubReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: GitHubReviewRequest) => Promise<void> | void;
  isSubmitting?: boolean;
}

function parsePaths(rawPaths: string): string[] {
  return Array.from(
    new Set(
      rawPaths
        .split(/\r?\n/)
        .map((path) => path.trim())
        .filter(Boolean),
    ),
  );
}

function formatErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "GitHub 审查请求失败。";
}

export function GitHubReviewDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false,
}: GitHubReviewDialogProps) {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [ref, setRef] = useState("main");
  const [pathsText, setPathsText] = useState("");
  const [error, setError] = useState("");
  const [localSubmitting, setLocalSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setError("");
    }
  }, [open]);

  const paths = useMemo(() => parsePaths(pathsText), [pathsText]);
  const canSubmit = Boolean(
    repositoryUrl.trim() && ref.trim() && paths.length > 0 && !isSubmitting && !localSubmitting,
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedRepositoryUrl = repositoryUrl.trim();
    const trimmedRef = ref.trim();
    const parsedPaths = parsePaths(pathsText);

    if (!trimmedRepositoryUrl) {
      setError("请输入公开的 GitHub 仓库 URL。");
      return;
    }
    if (!trimmedRef) {
      setError("请输入要审查的 ref。");
      return;
    }
    if (parsedPaths.length === 0) {
      setError("请至少输入一个仓库相对路径。");
      return;
    }

    setError("");
    setLocalSubmitting(true);
    try {
      await onSubmit({
        repository_url: trimmedRepositoryUrl,
        ref: trimmedRef,
        paths: parsedPaths,
      });
      setRepositoryUrl("");
      setRef("main");
      setPathsText("");
      onOpenChange(false);
    } catch (submissionError) {
      setError(formatErrorMessage(submissionError));
    } finally {
      setLocalSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>GitHub 代码审查</DialogTitle>
          <DialogDescription>
            输入公开仓库 URL、要审查的 ref，以及每行一个仓库相对路径。
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="github-review-repository-url">
              仓库 URL
            </label>
            <Input
              id="github-review-repository-url"
              placeholder="https://github.com/owner/repo"
              value={repositoryUrl}
              onChange={(event) => setRepositoryUrl(event.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="github-review-ref">
              Ref
            </label>
            <Input
              id="github-review-ref"
              placeholder="main"
              value={ref}
              onChange={(event) => setRef(event.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="github-review-paths">
              路径
            </label>
            <textarea
              id="github-review-paths"
              className="min-h-[140px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={"src/app.ts\nsrc/lib/review.ts"}
              value={pathsText}
              onChange={(event) => setPathsText(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              支持目录。后端会自动展开目录，并只审查可读取的文本文件。
            </p>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting || localSubmitting}
            >
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting || localSubmitting ? "审查中..." : "开始审查"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
