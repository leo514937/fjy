import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGatewayProxyHeaders,
  shouldRetryWithServiceAuthFallback,
} from "../xgProxy.mjs";

test("buildGatewayProxyHeaders 会在无鉴权头时注入配置的 X-API-Key", () => {
  const headers = buildGatewayProxyHeaders(
    {
      accept: "application/json",
    },
    {
      host: "127.0.0.1:8080",
      apiKey: "real-key",
    },
  );

  assert.equal(headers.host, "127.0.0.1:8080");
  assert.equal(headers["X-API-Key"], "real-key");
});

test("buildGatewayProxyHeaders 会优先透传现有 Authorization，不重复注入 key", () => {
  const headers = buildGatewayProxyHeaders(
    {
      authorization: "Bearer existed-token",
    },
    {
      host: "127.0.0.1:8080",
      apiKey: "real-key",
    },
  );

  assert.equal(headers.authorization, "Bearer existed-token");
  assert.equal("X-API-Key" in headers, false);
});

test("buildGatewayProxyHeaders 会透传已有 Cookie，不重复注入 key", () => {
  const headers = buildGatewayProxyHeaders(
    {
      cookie: "xg_auth=token",
    },
    {
      host: "127.0.0.1:8080",
      apiKey: "real-key",
    },
  );

  assert.equal(headers.cookie, "xg_auth=token");
  assert.equal("X-API-Key" in headers, false);
});

test("shouldRetryWithServiceAuthFallback 会在旧 Authorization 导致 401 时触发回退", () => {
  assert.equal(
    shouldRetryWithServiceAuthFallback(
      {
        authorization: "Bearer stale-token",
      },
      401,
      "real-key",
    ),
    true,
  );
});

test("shouldRetryWithServiceAuthFallback 会在旧 Cookie 导致 401 时触发回退", () => {
  assert.equal(
    shouldRetryWithServiceAuthFallback(
      {
        cookie: "xg_session=stale-token",
      },
      401,
      "real-key",
    ),
    true,
  );
});

test("shouldRetryWithServiceAuthFallback 对显式 X-API-Key 不做回退", () => {
  assert.equal(
    shouldRetryWithServiceAuthFallback(
      {
        "x-api-key": "real-key",
      },
      401,
      "real-key",
    ),
    false,
  );
});

test("shouldRetryWithServiceAuthFallback 对非 401 不做回退", () => {
  assert.equal(
    shouldRetryWithServiceAuthFallback(
      {
        authorization: "Bearer stale-token",
      },
      200,
      "real-key",
    ),
    false,
  );
});
