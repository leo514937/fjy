const ENV_API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const DEV_FALLBACK_API_BASE = typeof window !== 'undefined' && (
  window.location.port === '5173'
  || window.location.port === '4173'
)
  ? 'http://localhost:8787'
  : '';
const API_BASE = ENV_API_BASE || DEV_FALLBACK_API_BASE;

export function buildApiUrl(path: string): string {
  if (!API_BASE) {
    return path;
  }

  return `${API_BASE}${path}`;
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
