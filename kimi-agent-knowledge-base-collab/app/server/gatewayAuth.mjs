const DEFAULT_GATEWAY_LOGIN_TIMEOUT_MS = 8_000;

function isAbortError(error) {
  return Boolean(
    error
    && typeof error === "object"
    && (error.name === "AbortError" || error.code === "ABORT_ERR"),
  );
}

export function createGatewayAccessTokenManager({
  gatewayUrl,
  username,
  password,
  timeoutMs = DEFAULT_GATEWAY_LOGIN_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  let gatewayAccessToken = "";
  let gatewayLoginPromise = null;

  async function ensureGatewayAccessToken() {
    if (gatewayAccessToken) {
      return gatewayAccessToken;
    }
    if (gatewayLoginPromise) {
      return gatewayLoginPromise;
    }
    if (!gatewayUrl) {
      throw new Error("Gateway login failed: missing gateway URL");
    }
    if (!username || !password) {
      throw new Error("Gateway login failed: missing credentials");
    }

    gatewayLoginPromise = (async () => {
      const loginUrl = new URL("/auth/login", gatewayUrl);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(loginUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({
            username,
            password,
          }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = payload?.detail || payload?.error || `${response.status} ${response.statusText}`;
          throw new Error(`Gateway login failed: ${detail}`);
        }

        const token = typeof payload?.access_token === "string" ? payload.access_token.trim() : "";
        if (!token) {
          throw new Error("Gateway login failed: missing access_token");
        }
        gatewayAccessToken = token;
        return token;
      } catch (error) {
        if (isAbortError(error)) {
          const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
          const timeoutLabel = timeoutSeconds === 1 ? "1 second" : `${timeoutSeconds} seconds`;
          throw new Error(`Gateway login failed: request timed out after ${timeoutLabel}`);
        }

        const detail = error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "unknown error";
        throw new Error(`Gateway login failed: ${detail}`);
      } finally {
        clearTimeout(timeoutId);
      }
    })();

    try {
      return await gatewayLoginPromise;
    } finally {
      gatewayLoginPromise = null;
    }
  }

  function resetGatewayAccessToken() {
    gatewayAccessToken = "";
  }

  return {
    ensureGatewayAccessToken,
    resetGatewayAccessToken,
  };
}
