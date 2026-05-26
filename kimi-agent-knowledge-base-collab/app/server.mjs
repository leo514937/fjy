import { createServer, request as httpRequest } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { DEFAULT_GATEWAY_URL, createAppServices } from "./server/createAppServices.mjs";
import { createGatewayAccessTokenManager } from "./server/gatewayAuth.mjs";
import {
  buildGatewayProxyHeaders,
  shouldRetryWithServiceAuthFallback,
} from "./server/xgProxy.mjs";
import { validateWorkflowEntityFileData } from "./server/workflowEntityFormat.mjs";

const PORT = Number(process.env.PORT || 8787);
const XG_GATEWAY_URL = process.env.ONTOGIT_GATEWAY_URL || process.env.XG_GATEWAY_URL || process.env.GATEWAY_URL || DEFAULT_GATEWAY_URL;
const XG_GATEWAY_API_KEY_RAW = process.env.XG_GATEWAY_API_KEY || process.env.GATEWAY_SERVICE_API_KEY || "";
const XG_GATEWAY_API_KEY = XG_GATEWAY_API_KEY_RAW && XG_GATEWAY_API_KEY_RAW !== "change-me" ? XG_GATEWAY_API_KEY_RAW : "";
const XG_GATEWAY_AUTH_USERNAME = process.env.ONTOGIT_AUTH_USERNAME || process.env.XG_AUTH_USERNAME || "mogong";
const XG_GATEWAY_AUTH_PASSWORD = process.env.ONTOGIT_AUTH_PASSWORD || process.env.XG_AUTH_PASSWORD || "123456";
const gatewayAuth = createGatewayAccessTokenManager({
  gatewayUrl: XG_GATEWAY_URL,
  username: XG_GATEWAY_AUTH_USERNAME,
  password: XG_GATEWAY_AUTH_PASSWORD,
});
const {
  knowledgeBaseService,
  assistantSessionStateService,
  conversationGraphStateService,
  workflowService,
  workflowV2Service,
  appRoot,
} = createAppServices();
const workflowControllers = new Map();
const workflowV2Controllers = new Map();
const workflowV2Subscribers = new Map();

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS,DELETE",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-API-Key,X-File-Name,X-Conversation-Id",
  };
}

function writeWithCors(res, status, headers, body) {
  res.writeHead(status, {
    ...headers,
    ...getCorsHeaders(),
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  writeWithCors(res, status, {
    "Content-Type": "application/json; charset=utf-8",
  }, JSON.stringify(payload));
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  writeWithCors(res, status, {
    "Content-Type": contentType,
  }, text);
}

function sendGatewayError(res, error) {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : "Gateway error";
  sendJson(res, 502, { error: message });
}

function openSse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    ...getCorsHeaders(),
  });
  res.write(": connected\n\n");
}

function writeSse(res, event, payload) {
  if (res.writableEnded) {
    return;
  }

  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function addWorkflowV2Subscriber(conversationId, res) {
  const subscribers = workflowV2Subscribers.get(conversationId) ?? new Set();
  subscribers.add(res);
  workflowV2Subscribers.set(conversationId, subscribers);
  const cleanup = () => {
    const current = workflowV2Subscribers.get(conversationId);
    if (!current) {
      return;
    }
    current.delete(res);
    if (current.size === 0) {
      workflowV2Subscribers.delete(conversationId);
    }
  };
  res.on("close", cleanup);
  res.on("error", cleanup);
  return cleanup;
}

function broadcastWorkflowV2Event(conversationId, event, payload) {
  const subscribers = workflowV2Subscribers.get(conversationId);
  if (!subscribers || subscribers.size === 0) {
    return;
  }
  for (const res of [...subscribers]) {
    if (res.writableEnded || res.destroyed) {
      subscribers.delete(res);
      continue;
    }
    writeSse(res, event, payload);
  }
  if (subscribers.size === 0) {
    workflowV2Subscribers.delete(conversationId);
  }
}

function closeWorkflowV2Subscribers(conversationId) {
  const subscribers = workflowV2Subscribers.get(conversationId);
  if (!subscribers) {
    return;
  }
  for (const res of [...subscribers]) {
    if (!res.writableEnded) {
      res.end();
    }
  }
  workflowV2Subscribers.delete(conversationId);
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function getStaticFilePath(urlPathname) {
  const relativePath = urlPathname === "/" ? "dist/index.html" : `dist${urlPathname}`;
  return path.join(appRoot, relativePath);
}

function getContentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

async function readRequestBodyBuffer(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
}

function proxyRequest(targetUrl, method, headers, bodyBuffer) {
  return new Promise((resolve, reject) => {
    const proxyReq = httpRequest(targetUrl, { method, headers }, (proxyRes) => {
      const responseChunks = [];
      proxyRes.on("data", (chunk) => {
        responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      proxyRes.on("end", () => {
        resolve({
          statusCode: proxyRes.statusCode ?? 502,
          headers: proxyRes.headers,
          body: responseChunks.length > 0 ? Buffer.concat(responseChunks) : Buffer.alloc(0),
        });
      });
    });

    proxyReq.on("error", reject);

    if (bodyBuffer && bodyBuffer.length > 0) {
      proxyReq.write(bodyBuffer);
    }
    proxyReq.end();
  });
}

async function buildServiceGatewayHeaders(sourceHeaders, targetHost) {
  const headers = buildGatewayProxyHeaders(sourceHeaders, {
    host: targetHost,
    apiKey: XG_GATEWAY_API_KEY,
  });

  try {
    const accessToken = await gatewayAuth.ensureGatewayAccessToken();
    delete headers["X-API-Key"];
    delete headers["x-api-key"];
    delete headers.cookie;
    delete headers.Cookie;
    headers.Authorization = `Bearer ${accessToken}`;
  } catch (error) {
    const hasAuthHeader = Boolean(
      headers.Authorization
      || headers.authorization
      || headers["X-API-Key"]
      || headers["x-api-key"]
      || headers.Cookie
      || headers.cookie,
    );
    if (!hasAuthHeader) {
      throw error instanceof Error ? error : new Error("Gateway authentication is unavailable");
    }
  }

  const hasAuthHeader = Boolean(
    headers.Authorization
    || headers.authorization
    || headers["X-API-Key"]
    || headers["x-api-key"]
    || headers.Cookie
    || headers.cookie,
  );
  if (!hasAuthHeader) {
    throw new Error("Gateway authentication is unavailable");
  }

  return headers;
}

const server = createServer(async (req, res) => {
  try {
    if (!req.url) {
      sendJson(res, 400, { error: "Missing request URL" });
      return;
    }

    if (req.method === "OPTIONS") {
      sendText(res, 204, "");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        workflowAvailable: true,
        workflowMode: "linear",
        provider: "ontogit",
        knowledgeGraphSource: "ontogit-gateway",
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/workflow/config") {
      await workflowService.refreshWorkflowConfigFromResolver();
      const config = workflowService.getWorkflowConfig();
      sendJson(res, 200, { ...config, version: "v1.0.1-10percent-fix" });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/workflow/config") {
      const body = await parseBody(req);
      const workflowModel = typeof body?.workflowModel === "string" ? body.workflowModel.trim() : undefined;
      const workflowModelA = typeof body?.workflowModelA === "string" ? body.workflowModelA.trim() : undefined;
      const workflowModelB = typeof body?.workflowModelB === "string" ? body.workflowModelB.trim() : undefined;
      const workflowParallelCount = body?.workflowParallelCount;
      const workflowDebateRounds = body?.workflowDebateRounds;

      if (
        workflowModel === undefined
        && workflowModelA === undefined
        && workflowModelB === undefined
        && workflowParallelCount === undefined
        && workflowDebateRounds === undefined
      ) {
        sendJson(res, 400, { error: "workflow config payload is required" });
        return;
      }

      sendJson(res, 200, workflowService.setWorkflowConfig({
        workflowModel,
        workflowModelA,
        workflowModelB,
        workflowParallelCount,
        workflowDebateRounds,
      }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/workflow/v2/config") {
      await workflowV2Service.refreshWorkflowConfigFromResolver();
      sendJson(res, 200, workflowV2Service.getWorkflowConfig());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/workflow/v2/config") {
      const body = await parseBody(req);
      sendJson(res, 200, workflowV2Service.setWorkflowConfig({
        workflowModel: typeof body?.workflowModel === "string" ? body.workflowModel.trim() : undefined,
        workflowModelA: typeof body?.workflowModelA === "string" ? body.workflowModelA.trim() : undefined,
        workflowModelB: typeof body?.workflowModelB === "string" ? body.workflowModelB.trim() : undefined,
        workflowJudgeModel: typeof body?.workflowJudgeModel === "string" ? body.workflowJudgeModel.trim() : undefined,
        chunkMaxChars: body?.chunkMaxChars,
        chunkMinChars: body?.chunkMinChars,
        windowSize: body?.windowSize,
        windowStep: body?.windowStep,
        parallelWindows: body?.parallelWindows,
      }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/workflow/v2/session") {
      const conversationId = typeof url.searchParams.get("conversationId") === "string"
        ? url.searchParams.get("conversationId").trim()
        : "";
      if (!conversationId) {
        sendJson(res, 400, { error: "conversationId is required" });
        return;
      }
      try {
        const payload = await workflowV2Service.getFileWorkflowSession(conversationId);
        sendJson(res, 200, payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : "workflow V2 session not found";
        if (/ENOENT/i.test(message)) {
          sendJson(res, 404, { error: "workflow V2 session snapshot not found" });
          return;
        }
        sendJson(res, 500, { error: message });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/knowledge-graph") {
      const projectId = url.searchParams.get("project_id") || undefined;
      if (url.searchParams.get("refresh") === "1" && typeof knowledgeBaseService.repository?.invalidateCache === "function") {
        knowledgeBaseService.repository.invalidateCache(projectId);
      }
      sendJson(res, 200, await knowledgeBaseService.getKnowledgeGraph(projectId));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/knowledge-graph/slice") {
      const body = await parseBody(req);
      const refs = Array.isArray(body?.refs) ? body.refs.filter((ref) => typeof ref === "string") : [];
      const projectId = typeof body?.project_id === "string" ? body.project_id : undefined;
      sendJson(res, 200, await knowledgeBaseService.getKnowledgeGraphSlice(refs, projectId));
      return;
    }

    if (url.pathname.startsWith("/api/xg/")) {
      const targetPath = url.pathname.replace("/api/xg/", "/xg/");
      const targetUrl = new URL(targetPath + url.search, XG_GATEWAY_URL);

      try {
        const bodyBuffer = await readRequestBodyBuffer(req);
        if (req.method === "POST" && url.pathname === "/api/xg/write-and-infer") {
          const parsed = bodyBuffer.byteLength > 0 ? JSON.parse(bodyBuffer.toString("utf8")) : {};
          const validation = validateWorkflowEntityFileData(parsed?.data);
          if (!validation.ok) {
            sendJson(res, 400, {
              error: "Only workflow entity JSON format is accepted",
              detail: validation.error,
            });
            return;
          }
        }

        let gatewayHeaders = await buildServiceGatewayHeaders(req.headers, targetUrl.host);
        const usingServiceAuth = Boolean(gatewayHeaders.Authorization);

        let proxyRes = await proxyRequest(
          targetUrl,
          req.method,
          gatewayHeaders,
          bodyBuffer,
        );

        if (proxyRes.statusCode === 401 && usingServiceAuth) {
          gatewayAuth.resetGatewayAccessToken();
          gatewayHeaders = await buildServiceGatewayHeaders(req.headers, targetUrl.host);
          proxyRes = await proxyRequest(
            targetUrl,
            req.method,
            gatewayHeaders,
            bodyBuffer,
          );
        } else if (proxyRes.statusCode === 401) {
          const accessToken = await gatewayAuth.ensureGatewayAccessToken();
          proxyRes = await proxyRequest(
            targetUrl,
            req.method,
            {
              ...buildGatewayProxyHeaders(req.headers, {
                host: targetUrl.host,
                apiKey: XG_GATEWAY_API_KEY,
                forceApiKey: true,
              }),
              Authorization: `Bearer ${accessToken}`,
            },
            bodyBuffer,
          );
        } else if (shouldRetryWithServiceAuthFallback(req.headers, proxyRes.statusCode, XG_GATEWAY_API_KEY)) {
          proxyRes = await proxyRequest(
            targetUrl,
            req.method,
            buildGatewayProxyHeaders(req.headers, {
              host: targetUrl.host,
              apiKey: XG_GATEWAY_API_KEY,
              forceApiKey: true,
            }),
            bodyBuffer,
          );
        }

        writeWithCors(res, proxyRes.statusCode, proxyRes.headers, proxyRes.body);
      } catch (err) {
        sendGatewayError(res, err);
      }
      return;
    }

    if (url.pathname.startsWith("/auth/")) {
      const targetUrl = new URL(url.pathname + url.search, XG_GATEWAY_URL);

      try {
        const bodyBuffer = await readRequestBodyBuffer(req);
        const proxyRes = await proxyRequest(
          targetUrl,
          req.method,
          buildGatewayProxyHeaders(req.headers, {
            host: targetUrl.host,
            apiKey: XG_GATEWAY_API_KEY,
          }),
          bodyBuffer,
        );

        writeWithCors(res, proxyRes.statusCode, proxyRes.headers, proxyRes.body);
      } catch (err) {
        sendGatewayError(res, err);
      }
      return;
    }

    if (url.pathname.startsWith("/api/probability/")) {
      const targetPath = url.pathname.replace("/api/probability/", "/probability/");
      const targetUrl = new URL(targetPath + url.search, XG_GATEWAY_URL);

      try {
        const bodyBuffer = await readRequestBodyBuffer(req);
        let gatewayHeaders = await buildServiceGatewayHeaders(req.headers, targetUrl.host);
        const usingServiceAuth = Boolean(gatewayHeaders.Authorization);

        let proxyRes = await proxyRequest(targetUrl, req.method, gatewayHeaders, bodyBuffer);
        if (proxyRes.statusCode === 401 && usingServiceAuth) {
          gatewayAuth.resetGatewayAccessToken();
          gatewayHeaders = await buildServiceGatewayHeaders(req.headers, targetUrl.host);
          proxyRes = await proxyRequest(targetUrl, req.method, gatewayHeaders, bodyBuffer);
        } else if (proxyRes.statusCode === 401) {
          const accessToken = await gatewayAuth.ensureGatewayAccessToken();
          proxyRes = await proxyRequest(
            targetUrl,
            req.method,
            {
              ...buildGatewayProxyHeaders(req.headers, {
                host: targetUrl.host,
                apiKey: XG_GATEWAY_API_KEY,
                forceApiKey: true,
              }),
              Authorization: `Bearer ${accessToken}`,
            },
            bodyBuffer,
          );
        }

        writeWithCors(res, proxyRes.statusCode, proxyRes.headers, proxyRes.body);
      } catch (err) {
        sendGatewayError(res, err);
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/ontologies") {
      sendJson(res, 200, await knowledgeBaseService.getOntologies());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/search") {
      const query = url.searchParams.get("q") || "";
      sendJson(res, 200, await knowledgeBaseService.searchEntities(query, url.searchParams.get("project_id") || undefined));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/analysis") {
      const query = url.searchParams.get("q") || "";
      if (!query.trim()) {
        sendJson(res, 400, { error: "q is required" });
        return;
      }

      sendJson(res, 200, await knowledgeBaseService.getAnalysis(query, url.searchParams.get("entityId") || undefined));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/system-analysis") {
      const query = url.searchParams.get("q") || "";
      if (!query.trim()) {
        sendJson(res, 400, { error: "q is required" });
        return;
      }

      sendJson(res, 200, await knowledgeBaseService.getSystemAnalysis(query, url.searchParams.get("entityId") || undefined));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/education") {
      sendJson(res, 200, await knowledgeBaseService.getEducationContent(url.searchParams.get("entityId") || undefined));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/editor/workspace") {
      sendJson(res, 200, await knowledgeBaseService.getEditorWorkspace(url.searchParams.get("entityId") || undefined));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/editor/preview") {
      const body = await parseBody(req);
      if (body.mode && body.mode !== "json") {
        sendJson(res, 400, { error: "仅支持标准工作流实体 JSON（mode 必须为 json）" });
        return;
      }
      const validation = validateWorkflowEntityFileData(body.source);
      if (!validation.ok) {
        sendJson(res, 400, { error: `仅支持标准工作流实体 JSON。${validation.error}` });
        return;
      }
      sendJson(res, 200, await knowledgeBaseService.previewEditorDraft({
        entityId: typeof body.entityId === "string" ? body.entityId : undefined,
        mode: "json",
        layer: typeof body.layer === "string" ? body.layer : undefined,
        slug: typeof body.slug === "string" ? body.slug : "",
        source: body.source,
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/editor/commit") {
      const body = await parseBody(req);
      if (body.mode && body.mode !== "json") {
        sendJson(res, 400, { error: "仅支持标准工作流实体 JSON（mode 必须为 json）" });
        return;
      }
      const validation = validateWorkflowEntityFileData(body.source);
      if (!validation.ok) {
        sendJson(res, 400, { error: `仅支持标准工作流实体 JSON。${validation.error}` });
        return;
      }
      sendJson(res, 200, await knowledgeBaseService.commitEditorDraft({
        entityId: typeof body.entityId === "string" ? body.entityId : undefined,
        mode: "json",
        projectId: typeof body.projectId === "string" ? body.projectId : "demo",
        layer: typeof body.layer === "string" ? body.layer : undefined,
        slug: typeof body.slug === "string" ? body.slug : "",
        message: typeof body.message === "string" ? body.message : "",
        source: body.source,
      }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/chat/state") {
      sendJson(res, 200, await assistantSessionStateService.load());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/chat/state") {
      const body = await parseBody(req);
      sendJson(res, 200, await assistantSessionStateService.save(body));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/chat/graph") {
      const conversationId = typeof url.searchParams.get("conversationId") === "string"
        ? url.searchParams.get("conversationId").trim()
        : "";
      if (!conversationId) {
        sendJson(res, 400, { error: "conversationId is required" });
        return;
      }

      sendJson(res, 200, await conversationGraphStateService.load(conversationId));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/chat/graph") {
      const body = await parseBody(req);
      const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
      if (!conversationId) {
        sendJson(res, 400, { error: "conversationId is required" });
        return;
      }

      sendJson(res, 200, await conversationGraphStateService.save(body));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/chat/upload") {
      const body = await parseBody(req);
      const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
      const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
      const contentBase64 = typeof body.contentBase64 === "string" ? body.contentBase64.trim() : "";
      const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim() : "application/octet-stream";

      if (!conversationId) {
        sendJson(res, 400, { error: "conversationId is required" });
        return;
      }
      if (!fileName) {
        sendJson(res, 400, { error: "fileName is required" });
        return;
      }
      if (!contentBase64) {
        sendJson(res, 400, { error: "contentBase64 is required" });
        return;
      }

      const runtimeRoot = workflowService.getConversationRuntimeRoot(conversationId);
      const uploadsDir = path.join(runtimeRoot, "uploads");
      const safeFileName = fileName.replace(/[\\/]+/g, "_").replace(/\0/g, "").trim() || "upload.bin";
      const filePath = path.join(uploadsDir, safeFileName);

      await mkdir(uploadsDir, { recursive: true });
      await writeFile(filePath, Buffer.from(contentBase64, "base64"));

      sendJson(res, 200, {
        ok: true,
        conversationId,
        runtimeRoot,
        uploadsDir,
        filePath,
        fileName: safeFileName,
        mimeType,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/workflow/file/run") {
      const fileName = typeof url.searchParams.get("fileName") === "string"
        ? url.searchParams.get("fileName").trim()
        : "";
      const projectId = typeof url.searchParams.get("projectId") === "string"
        ? url.searchParams.get("projectId").trim()
        : "";
      const conversationId = typeof url.searchParams.get("conversationId") === "string"
        ? url.searchParams.get("conversationId").trim()
        : "";
      const bodyBuffer = await readRequestBodyBuffer(req);

      if (!fileName) {
        sendJson(res, 400, { error: "fileName is required" });
        return;
      }
      if (bodyBuffer.byteLength === 0) {
        sendJson(res, 400, { error: "file content is empty" });
        return;
      }
      if (!projectId) {
        sendJson(res, 400, { error: "projectId is required" });
        return;
      }

      const result = await workflowService.runFileWorkflow({
        fileName: decodeURIComponent(fileName),
        projectId: decodeURIComponent(projectId),
        mimeType: typeof req.headers["content-type"] === "string"
          ? req.headers["content-type"]
          : "application/octet-stream",
        content: bodyBuffer,
        conversationId,
      });

      if (typeof knowledgeBaseService.repository?.invalidateCache === "function") {
        knowledgeBaseService.repository.invalidateCache(decodeURIComponent(projectId));
      }

      sendJson(res, result.ok ? 200 : 502, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/workflow/file/run/stream") {
      const fileName = typeof url.searchParams.get("fileName") === "string"
        ? url.searchParams.get("fileName").trim()
        : "";
      const projectId = typeof url.searchParams.get("projectId") === "string"
        ? url.searchParams.get("projectId").trim()
        : "";
      const conversationId = typeof url.searchParams.get("conversationId") === "string"
        ? url.searchParams.get("conversationId").trim()
        : "";
      const bodyBuffer = await readRequestBodyBuffer(req);

      if (!fileName) {
        sendJson(res, 400, { error: "fileName is required" });
        return;
      }
      if (bodyBuffer.byteLength === 0) {
        sendJson(res, 400, { error: "file content is empty" });
        return;
      }
      if (!projectId) {
        sendJson(res, 400, { error: "projectId is required" });
        return;
      }

      openSse(res);
      writeSse(res, "status", {
        message: "文件已接收，准备启动八阶段工作流",
      });

      const controller = new AbortController();
      const runKey = conversationId || "default";
      workflowControllers.set(runKey, controller);

      try {
        const result = await workflowService.runFileWorkflow({
          fileName: decodeURIComponent(fileName),
          projectId: decodeURIComponent(projectId),
          mimeType: typeof req.headers["content-type"] === "string"
            ? req.headers["content-type"]
            : "application/octet-stream",
          content: bodyBuffer,
          conversationId,
          signal: controller.signal,
          handlers: {
            onStatus(payload) {
              writeSse(res, "status", typeof payload === "string" ? { message: payload } : payload);
            },
            onStageUpdate(stageResult) {
              writeSse(res, "workflow_stage", stageResult);
            },
          },
        });

        if (typeof knowledgeBaseService.repository?.invalidateCache === "function") {
          knowledgeBaseService.repository.invalidateCache(decodeURIComponent(projectId));
        }

        writeSse(res, "complete", result);
        res.end();
        res.end();
      } finally {
        if (workflowControllers.get(runKey) === controller) {
          workflowControllers.delete(runKey);
        }
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/workflow/terminate") {
      const conversationId = typeof url.searchParams.get("conversationId") === "string"
        ? url.searchParams.get("conversationId").trim()
        : "default";
      const controller = workflowControllers.get(conversationId);
      if (controller) {
        controller.abort();
        workflowControllers.delete(conversationId);
        sendJson(res, 200, { ok: true, message: "Workflow termination signal sent" });
      } else {
        sendJson(res, 404, { error: "No running workflow found for this conversation" });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/workflow/file/retry/stream") {
      const projectId = typeof url.searchParams.get("projectId") === "string"
        ? url.searchParams.get("projectId").trim()
        : "";
      const conversationId = typeof url.searchParams.get("conversationId") === "string"
        ? url.searchParams.get("conversationId").trim()
        : "";
      const startStage = typeof url.searchParams.get("startStage") === "string"
        ? url.searchParams.get("startStage").trim()
        : "";

      if (!projectId) {
        sendJson(res, 400, { error: "projectId is required" });
        return;
      }
      if (!conversationId) {
        sendJson(res, 400, { error: "conversationId is required" });
        return;
      }
      if (!startStage) {
        sendJson(res, 400, { error: "startStage is required" });
        return;
      }

      openSse(res);
      writeSse(res, "status", {
        message: `正在从 ${startStage} 重试工作流`,
      });

      const controller = new AbortController();
      const runKey = conversationId;
      workflowControllers.set(runKey, controller);

      try {
        const result = await workflowService.retryFileWorkflowFromStage({
          projectId: decodeURIComponent(projectId),
          conversationId,
          startStage,
          signal: controller.signal,
          handlers: {
            onStatus(payload) {
              writeSse(res, "status", typeof payload === "string" ? { message: payload } : payload);
            },
            onStageUpdate(stageResult) {
              writeSse(res, "workflow_stage", stageResult);
            },
          },
        });

        if (typeof knowledgeBaseService.repository?.invalidateCache === "function") {
          knowledgeBaseService.repository.invalidateCache(decodeURIComponent(projectId));
        }

        writeSse(res, "complete", result);
        res.end();
        res.end();
      } finally {
        if (workflowControllers.get(runKey) === controller) {
          workflowControllers.delete(runKey);
        }
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/workflow/v2/file/run/stream") {
      const fileName = typeof url.searchParams.get("fileName") === "string"
        ? url.searchParams.get("fileName").trim()
        : "";
      const projectId = typeof url.searchParams.get("projectId") === "string"
        ? url.searchParams.get("projectId").trim()
        : "";
      const conversationId = typeof url.searchParams.get("conversationId") === "string"
        ? url.searchParams.get("conversationId").trim()
        : "";
      const bodyBuffer = await readRequestBodyBuffer(req);

      if (!fileName) {
        sendJson(res, 400, { error: "fileName is required" });
        return;
      }
      if (bodyBuffer.byteLength === 0) {
        sendJson(res, 400, { error: "file content is empty" });
        return;
      }
      if (!projectId) {
        sendJson(res, 400, { error: "projectId is required" });
        return;
      }

      openSse(res);
      addWorkflowV2Subscriber(conversationId || "default", res);
      writeSse(res, "status", {
        message: "文件已接收，准备启动 V2 六阶段分析工作流",
      });

      const controller = new AbortController();
      const runKey = conversationId || "default";
      workflowV2Controllers.set(runKey, controller);

      try {
        const result = await workflowV2Service.runFileWorkflow({
          fileName: decodeURIComponent(fileName),
          projectId: decodeURIComponent(projectId),
          mimeType: typeof req.headers["content-type"] === "string"
            ? req.headers["content-type"]
            : "application/octet-stream",
          content: bodyBuffer,
          conversationId,
          signal: controller.signal,
          handlers: {
            onStatus(payload) {
              broadcastWorkflowV2Event(runKey, "status", typeof payload === "string" ? { message: payload } : payload);
            },
            onStageUpdate(stageResult) {
              broadcastWorkflowV2Event(runKey, "workflow_stage", stageResult);
            },
          },
        });

        broadcastWorkflowV2Event(runKey, "complete", result);
        closeWorkflowV2Subscribers(runKey);
      } catch (error) {
        broadcastWorkflowV2Event(runKey, "error", {
          message: error instanceof Error ? error.message : "V2 workflow server error",
        });
        closeWorkflowV2Subscribers(runKey);
      } finally {
        if (workflowV2Controllers.get(runKey) === controller) {
          workflowV2Controllers.delete(runKey);
        }
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/workflow/v2/attach/stream") {
      const conversationId = typeof url.searchParams.get("conversationId") === "string"
        ? url.searchParams.get("conversationId").trim()
        : "";
      if (!conversationId) {
        sendJson(res, 400, { error: "conversationId is required" });
        return;
      }
      if (!workflowV2Controllers.has(conversationId)) {
        sendJson(res, 404, { error: "No running workflow V2 found for this conversation" });
        return;
      }
      openSse(res);
      addWorkflowV2Subscriber(conversationId, res);
      writeSse(res, "status", {
        message: "已重新连接到正在运行的 V2 工作流",
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/workflow/v2/terminate") {
      const conversationId = typeof url.searchParams.get("conversationId") === "string"
        ? url.searchParams.get("conversationId").trim()
        : "default";
      const controller = workflowV2Controllers.get(conversationId);
      if (controller) {
        controller.abort();
        workflowV2Controllers.delete(conversationId);
        closeWorkflowV2Subscribers(conversationId);
        sendJson(res, 200, { ok: true, message: "Workflow V2 termination signal sent" });
      } else {
        sendJson(res, 404, { error: "No running workflow V2 found for this conversation" });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/workflow/v2/file/retry/stream") {
      const projectId = typeof url.searchParams.get("projectId") === "string"
        ? url.searchParams.get("projectId").trim()
        : "";
      const conversationId = typeof url.searchParams.get("conversationId") === "string"
        ? url.searchParams.get("conversationId").trim()
        : "";
      const startStage = typeof url.searchParams.get("startStage") === "string"
        ? url.searchParams.get("startStage").trim()
        : "";

      if (!projectId) {
        sendJson(res, 400, { error: "projectId is required" });
        return;
      }
      if (!conversationId) {
        sendJson(res, 400, { error: "conversationId is required" });
        return;
      }
      if (!startStage) {
        sendJson(res, 400, { error: "startStage is required" });
        return;
      }

      openSse(res);
      addWorkflowV2Subscriber(conversationId, res);
      writeSse(res, "status", {
        message: `正在从 ${startStage} 重试 V2 工作流`,
      });

      const controller = new AbortController();
      const runKey = conversationId;
      workflowV2Controllers.set(runKey, controller);

      try {
        const result = await workflowV2Service.retryFileWorkflowFromStage({
          projectId: decodeURIComponent(projectId),
          conversationId,
          startStage,
          signal: controller.signal,
          handlers: {
            onStatus(payload) {
              broadcastWorkflowV2Event(runKey, "status", typeof payload === "string" ? { message: payload } : payload);
            },
            onStageUpdate(stageResult) {
              broadcastWorkflowV2Event(runKey, "workflow_stage", stageResult);
            },
          },
        });
        broadcastWorkflowV2Event(runKey, "complete", result);
        closeWorkflowV2Subscribers(runKey);
      } catch (error) {
        broadcastWorkflowV2Event(runKey, "error", {
          message: error instanceof Error ? error.message : "V2 workflow retry server error",
        });
        closeWorkflowV2Subscribers(runKey);
      } finally {
        if (workflowV2Controllers.get(runKey) === controller) {
          workflowV2Controllers.delete(runKey);
        }
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/chat/stream") {
      const body = await parseBody(req);
      const question = typeof body.question === "string" ? body.question.trim() : "";
      const entityId = typeof body.entityId === "string" ? body.entityId : undefined;
      const conversationId = typeof body.conversationId === "string" ? body.conversationId : undefined;
      const businessPrompt = typeof body.businessPrompt === "string" ? body.businessPrompt : undefined;

      if (!question) {
        sendJson(res, 400, { error: "question is required" });
        return;
      }

      const context = await knowledgeBaseService.collectChatContext(question, entityId);
      const abortController = new AbortController();
      let streamCompleted = false;

      res.on("close", () => {
        if (!streamCompleted) {
          abortController.abort();
        }
      });

      openSse(res);
      writeSse(res, "context", context);
      writeSse(res, "status", {
        message: "已整理知识库上下文，准备执行固定线性工作流...",
      });

      try {
        const result = await workflowService.askStream(
          question,
          context,
          {
            onStatus(message) {
              writeSse(res, "status", { message });
            },
            onAnswerDelta(delta) {
              writeSse(res, "answer_delta", { delta });
            },
            onAssistantCompleted(assistantTurn) {
              writeSse(res, "assistant_completed", assistantTurn);
            },
            onToolStarted(toolRun) {
              writeSse(res, "tool_started", toolRun);
            },
            onToolOutput(toolOutput) {
              writeSse(res, "tool_output", toolOutput);
            },
            onToolFinished(toolRun) {
              writeSse(res, "tool_finished", toolRun);
            },
            onExecutionStage(executionStage) {
              writeSse(res, "execution_stage", executionStage);
            },
          },
          {
            conversationId,
            businessPrompt,
            signal: abortController.signal,
          }
        );

        const isGracefulMaxStepStop = (
          result.raw
          && typeof result.raw === "object"
          && result.raw.status === "success"
          && (
            result.raw.code === "run.empty_answer"
            || result.raw.code === "run.completed"
          )
        );

        if (!result.ok && !isGracefulMaxStepStop) {
          writeSse(res, "error", {
            message: result.error,
            context,
            raw: result.raw,
            stderr: result.stderr,
          });
          res.end();
          return;
        }

        writeSse(res, "complete", {
          answer: result.answer,
          context,
          raw: result.raw,
          stderr: result.stderr,
          warning: !result.ok ? result.error : undefined,
        });
        streamCompleted = true;
        res.end();
      } catch (error) {
        if (!res.writableEnded) {
          writeSse(res, "error", {
            message: error instanceof Error ? error.message : "Unknown server error",
          });
          streamCompleted = true;
          res.end();
        }
      }
      return;
    }

    const staticFilePath = getStaticFilePath(url.pathname);
    if (existsSync(staticFilePath)) {
      const content = await readFile(staticFilePath);
      sendText(res, 200, content, getContentType(staticFilePath));
      return;
    }

    const fallbackPath = path.join(appRoot, "dist", "index.html");
    if (existsSync(fallbackPath)) {
      const fallback = await readFile(fallbackPath, "utf8");
      sendText(res, 200, fallback, "text/html; charset=utf-8");
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Unknown server error",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Ontology API server listening on http://localhost:${PORT}`);
});
