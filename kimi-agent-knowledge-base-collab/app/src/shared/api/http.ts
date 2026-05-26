const runtimeImportMeta = import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } };
const ENV_API_BASE = runtimeImportMeta.env?.VITE_API_BASE_URL ?? '';
const DEV_FALLBACK_API_BASE = typeof window !== 'undefined' && (
  window.location.port === '5173'
  || window.location.port === '4173'
)
  ? 'http://localhost:8787'
  : '';
const API_BASE = ENV_API_BASE || DEV_FALLBACK_API_BASE;
const AUTH_TOKEN_STORAGE_KEY = 'xg_access_token';
const AUTH_USERNAME = 'mogong';
const AUTH_PASSWORD = '123456';
let browserFetchPatched = false;
let browserLoginPromise: Promise<string> | null = null;

export function buildApiUrl(path: string): string {
  if (!API_BASE) {
    return path;
  }

  return `${API_BASE}${path}`;
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return withBrowserAuth(path, init);
}

export function getStoredAccessToken(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

export function setStoredAccessToken(token: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const normalizedToken = token.trim();
    if (normalizedToken) {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, normalizedToken);
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
  } catch {
    // localStorage 不可用时静默失败，避免影响主流程。
  }
}

export function clearStoredAccessToken(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // 同上：只负责尽力清理，不阻断页面行为。
  }
}

export function describeRequestError(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage.trim();
    }
  }

  return fallbackMessage;
}

function shouldAttachAuthHeader(input: RequestInfo | URL): boolean {
  const urlText = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  if (!urlText) {
    return false;
  }

  try {
    const requestUrl = new URL(urlText, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    return (
      requestUrl.pathname.startsWith('/api/')
      || requestUrl.pathname.startsWith('/auth/')
      || requestUrl.pathname === '/health'
    );
  } catch {
    return false;
  }
}

function attachStoredAuthHeader(input: RequestInfo | URL, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const token = getStoredAccessToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return {
    ...init,
    headers,
  };
}

function disableCacheForReadRequest(init: RequestInit = {}): RequestInit {
  const method = (init.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return init;
  }

  return {
    ...init,
    cache: 'no-store',
  };
}

async function ensureBrowserAccessToken(): Promise<string> {
  if (typeof window === 'undefined') {
    return '';
  }

  const existingToken = getStoredAccessToken();
  if (existingToken) {
    return existingToken;
  }

  if (browserLoginPromise) {
    return browserLoginPromise;
  }

  browserLoginPromise = (async () => {
    const response = await fetch(buildApiUrl('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: AUTH_USERNAME,
        password: AUTH_PASSWORD,
      }),
    });
    const payload = await response.json().catch(() => ({} as { access_token?: string }));
    const accessToken = typeof payload?.access_token === 'string' ? payload.access_token.trim() : '';
    if (!response.ok || !accessToken) {
      throw new Error(typeof payload?.detail === 'string' ? payload.detail : '自动登录失败');
    }

    setStoredAccessToken(accessToken);
    return accessToken;
  })();

  try {
    return await browserLoginPromise;
  } finally {
    browserLoginPromise = null;
  }
}

function shouldSkipAutoLogin(path: string): boolean {
  return path === '/auth/login' || path === '/auth/logout';
}

async function withBrowserAuth(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  if (typeof window !== 'undefined' && !shouldSkipAutoLogin(path)) {
    await ensureBrowserAccessToken();
  }

  const requestInit = attachStoredAuthHeader(path, disableCacheForReadRequest(init));
  const response = await fetch(buildApiUrl(path), requestInit);
  if (retry && typeof window !== 'undefined' && !shouldSkipAutoLogin(path) && response.status === 401) {
    clearStoredAccessToken();
    await ensureBrowserAccessToken();
    return withBrowserAuth(path, init, false);
  }

  return response;
}

export function installBrowserAuthFetch(): void {
  if (browserFetchPatched || typeof window === 'undefined') {
    return;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!shouldAttachAuthHeader(input)) {
      return originalFetch(input, init);
    }

    const urlText = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const path = new URL(urlText, window.location.href).pathname;
    if (shouldSkipAutoLogin(path)) {
      return originalFetch(input, attachStoredAuthHeader(input, init));
    }

    return ensureBrowserAccessToken()
      .then(() => originalFetch(input, attachStoredAuthHeader(input, init)));
  }) as typeof window.fetch;
  browserFetchPatched = true;
}

export function parseSseEvent(rawEvent: string): { event: string; data: unknown } | null {
  const lines = rawEvent
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const eventLine = lines.find((line) => line.startsWith('event: '));
  const dataLine = lines.find((line) => line.startsWith('data: '));
  if (!eventLine || !dataLine) {
    return null;
  }

  return {
    event: eventLine.slice('event: '.length),
    data: JSON.parse(dataLine.slice('data: '.length)),
  };
}

export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    if (text) {
      try {
        const payload = JSON.parse(text) as { error?: unknown; detail?: unknown };
        const message = typeof payload.error === 'string'
          ? payload.error
          : typeof payload.detail === 'string'
            ? payload.detail
            : text;
        throw new Error(message);
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error(text);
        }
        throw error;
      }
    }
    throw new Error(`Request failed with status ${response.status}`);
  }

  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}
