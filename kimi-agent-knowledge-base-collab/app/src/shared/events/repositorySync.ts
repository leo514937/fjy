export interface RepositorySyncDetail {
  projectId?: string;
  filename?: string;
  source?: string;
}

export const REPOSITORY_SYNC_EVENT = 'ontogit:repository-sync';

export function notifyRepositorySync(detail: RepositorySyncDetail = {}): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent<RepositorySyncDetail>(REPOSITORY_SYNC_EVENT, { detail }));
}

export function subscribeRepositorySync(
  listener: (detail: RepositorySyncDetail) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handler = (event: Event) => {
    listener((event as CustomEvent<RepositorySyncDetail>).detail || {});
  };

  window.addEventListener(REPOSITORY_SYNC_EVENT, handler);
  return () => window.removeEventListener(REPOSITORY_SYNC_EVENT, handler);
}
