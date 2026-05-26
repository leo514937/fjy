import assert from "node:assert/strict";
import test from "node:test";

import { createGatewayAccessTokenManager } from "../gatewayAuth.mjs";

test("createGatewayAccessTokenManager caches a successful login token", async () => {
  let fetchCalls = 0;
  const manager = createGatewayAccessTokenManager({
    gatewayUrl: "http://gateway.local",
    username: "mogong",
    password: "123456",
    fetchImpl: async (url, init) => {
      fetchCalls += 1;

      assert.equal(url.toString(), "http://gateway.local/auth/login");
      assert.equal(init.method, "POST");
      assert.equal(init.headers["Content-Type"], "application/json; charset=utf-8");
      assert.deepEqual(JSON.parse(init.body), {
        username: "mogong",
        password: "123456",
      });

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          access_token: "  token-123  ",
        }),
      };
    },
  });

  const firstToken = await manager.ensureGatewayAccessToken();
  const secondToken = await manager.ensureGatewayAccessToken();

  assert.equal(firstToken, "token-123");
  assert.equal(secondToken, "token-123");
  assert.equal(fetchCalls, 1);
});

test("createGatewayAccessTokenManager aborts slow gateway login requests", async () => {
  let fetchCalls = 0;
  const manager = createGatewayAccessTokenManager({
    gatewayUrl: "http://gateway.local",
    username: "mogong",
    password: "123456",
    timeoutMs: 5,
    fetchImpl: async (_url, init) => {
      fetchCalls += 1;

      return new Promise((resolve, reject) => {
        const signal = init.signal;
        if (signal?.aborted) {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          error.code = "ABORT_ERR";
          reject(error);
          return;
        }

        signal?.addEventListener("abort", () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          error.code = "ABORT_ERR";
          reject(error);
        }, { once: true });
      });
    },
  });

  await assert.rejects(
    manager.ensureGatewayAccessToken(),
    /request timed out after 1 second/,
  );
  assert.equal(fetchCalls, 1);
});
