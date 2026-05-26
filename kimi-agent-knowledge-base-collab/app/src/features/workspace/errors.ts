import { describeRequestError } from '@/shared/api/http';

function buildHint(message: string, fallbackMessage: string, hint?: string): string {
  if (!hint) {
    return message;
  }

  if (message === fallbackMessage || message === '请稍后重试') {
    return `${message}（${hint}）`;
  }

  return `${message}（${hint}）`;
}

export function formatWorkspaceError(
  error: unknown,
  fallbackMessage: string,
  hint?: string,
): string {
  const message = describeRequestError(error, fallbackMessage);
  return buildHint(message, fallbackMessage, hint);
}
