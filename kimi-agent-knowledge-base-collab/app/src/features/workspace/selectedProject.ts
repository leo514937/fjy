const STORAGE_KEY = 'xg-selected-project-id';
const PROJECT_CHANGE_EVENT = 'xg:selected-project-changed';
const DEFAULT_PROJECT_ID = 'demo';

function normalizeProjectId(projectId: string | null | undefined): string {
  const normalized = typeof projectId === 'string' ? projectId.trim() : '';
  return normalized || DEFAULT_PROJECT_ID;
}

export function getStoredSelectedProjectId(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_PROJECT_ID;
  }

  return normalizeProjectId(window.localStorage.getItem(STORAGE_KEY));
}

export function setStoredSelectedProjectId(projectId: string): string {
  const normalized = normalizeProjectId(projectId);
  if (typeof window === 'undefined') {
    return normalized;
  }

  window.localStorage.setItem(STORAGE_KEY, normalized);
  window.dispatchEvent(new CustomEvent(PROJECT_CHANGE_EVENT, {
    detail: { projectId: normalized },
  }));
  return normalized;
}

export function subscribeSelectedProjectIdChange(listener: (projectId: string) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleProjectChange = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : null;
    listener(normalizeProjectId(detail?.projectId));
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      listener(normalizeProjectId(event.newValue));
    }
  };

  window.addEventListener(PROJECT_CHANGE_EVENT, handleProjectChange as EventListener);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(PROJECT_CHANGE_EVENT, handleProjectChange as EventListener);
    window.removeEventListener('storage', handleStorage);
  };
}
