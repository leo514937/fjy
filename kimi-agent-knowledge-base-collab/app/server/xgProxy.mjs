function getHeader(sourceHeaders, ...names) {
  if (!sourceHeaders) {
    return undefined;
  }

  for (const name of names) {
    const value = sourceHeaders[name];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return undefined;
}

function hasAuthHeaders(sourceHeaders) {
  return Boolean(
    getHeader(sourceHeaders, "authorization", "Authorization")
    || getHeader(sourceHeaders, "cookie", "Cookie")
    || getHeader(sourceHeaders, "x-api-key", "X-API-Key"),
  );
}

export function buildGatewayProxyHeaders(sourceHeaders, options = {}) {
  const headers = {
    ...(sourceHeaders ?? {}),
  };

  if (options.host) {
    headers.host = options.host;
  }

  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  const forceApiKey = options.forceApiKey === true;
  if (forceApiKey) {
    delete headers.authorization;
    delete headers.Authorization;
    delete headers.cookie;
    delete headers.Cookie;
    delete headers["x-api-key"];
    delete headers["X-API-Key"];
  }

  if ((forceApiKey || !hasAuthHeaders(sourceHeaders)) && apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  return headers;
}

export function shouldRetryWithServiceAuthFallback(sourceHeaders, statusCode, apiKey) {
  const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!normalizedApiKey || statusCode !== 401 || !sourceHeaders) {
    return false;
  }

  if (getHeader(sourceHeaders, "x-api-key", "X-API-Key")) {
    return false;
  }

  return Boolean(
    getHeader(sourceHeaders, "authorization", "Authorization")
    || getHeader(sourceHeaders, "cookie", "Cookie"),
  );
}
