import { createServer, request as httpRequest } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { createAppServices } from "./server/createAppServices.mjs";
import {
  buildGatewayProxyHeaders,
  shouldRetryWithServiceAuthFallback,
} from "./server/xgProxy.mjs";

const PORT = Number(process.env.PORT || 8787);
const XG_GATEWAY_URL = process.env.XG_GATEWAY_URL || process.env.GATEWAY_URL || "http://127.0.0.1:8080";
const XG_GATEWAY_API_KEY = process.env.XG_GATEWAY_API_KEY || process.env.GATEWAY_SERVICE_API_KEY || "change-me";
const {
  knowledgeBaseService,
  assistantSessionStateService,
  conversationGraphStateService,
  localWorkspaceService,
  qagentService,
  appRoot,
} = createAppServices();

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS,DELETE",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS,DELETE",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(text);
}

function openSse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS,DELETE",
    "Access-Control-Allow-Headers": "Content-Type",
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

function parseConversationHistory(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (
      item && typeof item === "object"
        ? {
            question: typeof item.question === "string" ? item.question : "",
            answer: typeof item.answer === "string" ? item.answer : "",
            toolRuns: Array.isArray(item.toolRuns) ? item.toolRuns : [],
            contentBlocks: Array.isArray(item.contentBlocks) ? item.contentBlocks : [],
          }
        : null
    ))
    .filter(Boolean);
}

function normalizeConversationHistoryForPrompt(value, limit = Number.POSITIVE_INFINITY) {
  const seen = new Set();
  const history = [];

  for (const item of parseConversationHistory(value)) {
    const question = typeof item.question === "string" ? item.question.trim() : "";
    const answer = typeof item.answer === "string" ? item.answer.trim() : "";
    if (!question || !answer) {
      continue;
    }

    const signature = `${question}\u0000${answer}`;
    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    history.push({
      question,
      answer,
      toolRuns: Array.isArray(item.toolRuns) ? item.toolRuns : [],
      contentBlocks: Array.isArray(item.contentBlocks) ? item.contentBlocks : [],
    });
  }

  if (limit === Number.POSITIVE_INFINITY) {
    return history;
  }

  return history.slice(-limit);
}

function extractPersistedConversationHistory(state, conversationId, limit = Number.POSITIVE_INFINITY) {
  if (!conversationId || typeof conversationId !== "string") {
    return [];
  }

  const sessions = Array.isArray(state?.sessions) ? state.sessions : [];
  const session = sessions.find((item) => item && typeof item === "object" && item.id === conversationId);
  const messages = Array.isArray(session?.messages) ? session.messages : [];

  const history = messages
    .map((message) => {
    const question = typeof message?.question === "string" ? message.question.trim() : "";
    const answer = typeof message?.answer === "string" ? message.answer.trim() : "";
    if (!question || !answer) {
      return null;
    }
    return {
      question,
      answer,
      toolRuns: Array.isArray(message?.toolRuns) ? message.toolRuns : [],
      contentBlocks: Array.isArray(message?.contentBlocks) ? message.contentBlocks : [],
    };
  })
  .filter(Boolean);

  if (limit === Number.POSITIVE_INFINITY) {
    return history;
  }

  return history.slice(-limit);
}

function mergeConversationHistories(primary, fallback, limit = Number.POSITIVE_INFINITY) {
  const seen = new Set();
  const merged = [];

  for (const item of [...fallback, ...primary]) {
    const question = typeof item?.question === "string" ? item.question.trim() : "";
    const answer = typeof item?.answer === "string" ? item.answer.trim() : "";
    if (!question || !answer) {
      continue;
    }

    const signature = `${question}\u0000${answer}`;
    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    merged.push({
      question,
      answer,
      toolRuns: Array.isArray(item?.toolRuns) ? item.toolRuns : [],
      contentBlocks: Array.isArray(item?.contentBlocks) ? item.contentBlocks : [],
    });
  }

  if (limit === Number.POSITIVE_INFINITY) {
    return merged;
  }

  return merged.slice(-limit);
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
        qagentAvailable: true,
        provider: process.env.KNOWLEDGE_BASE_PROVIDER || "json",
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/knowledge-graph") {
      if (url.searchParams.get("refresh") === "1" && typeof knowledgeBaseService.repository?.invalidateCache === "function") {
        knowledgeBaseService.repository.invalidateCache();
      }
      sendJson(res, 200, await knowledgeBaseService.getKnowledgeGraph());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/knowledge-graph/slice") {
      const body = await parseBody(req);
      const refs = Array.isArray(body?.refs) ? body.refs.filter((ref) => typeof ref === "string") : [];
      sendJson(res, 200, await knowledgeBaseService.getKnowledgeGraphSlice(refs));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/workspace/projects") {
      sendJson(res, 200, { projects: await localWorkspaceService.listProjects() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/workspace/projects/init") {
      const body = await parseBody(req);
      const projectId = typeof body.project_id === "string" ? body.project_id : "";
      const name = typeof body.name === "string" ? body.name : undefined;
      const description = typeof body.description === "string" ? body.description : "";

      if (!projectId.trim()) {
        sendJson(res, 400, { error: "project_id is required" });
        return;
      }

      sendJson(res, 200, await localWorkspaceService.initProject({ projectId, name, description }));
      return;
    }

    const localProjectMatch = url.pathname.match(/^\/api\/workspace\/projects\/([^/]+)$/);
    if (req.method === "PATCH" && localProjectMatch) {
      const projectId = decodeURIComponent(localProjectMatch[1]);
      const body = await parseBody(req);
      const name = typeof body.name === "string" ? body.name : "";
      if (!name.trim()) {
        sendJson(res, 400, { error: "name is required" });
        return;
      }

      const result = await localWorkspaceService.updateProjectName(projectId, name);
      if (!result) {
        sendJson(res, 404, { error: `Project not found: ${projectId}` });
        return;
      }

      sendJson(res, 200, result);
      return;
    }

    const localDeleteProjectMatch = localProjectMatch;
    if (req.method === "DELETE" && localDeleteProjectMatch) {
      const projectId = decodeURIComponent(localDeleteProjectMatch[1]);
      sendJson(res, 200, await localWorkspaceService.deleteProject(projectId));
      return;
    }

    const localTimelinesMatch = url.pathname.match(/^\/api\/workspace\/projects\/([^/]+)\/timelines$/);
    if (req.method === "GET" && localTimelinesMatch) {
      const projectId = decodeURIComponent(localTimelinesMatch[1]);
      const timelines = await localWorkspaceService.getJsonFileTimelines(projectId);
      if (!timelines) {
        sendJson(res, 404, { error: `Project not found: ${projectId}` });
        return;
      }

      sendJson(res, 200, { timelines });
      return;
    }

    const localReadMatch = url.pathname.match(/^\/api\/workspace\/projects\/([^/]+)\/read\/(.+)$/);
    if (req.method === "GET" && localReadMatch) {
      const projectId = decodeURIComponent(localReadMatch[1]);
      const filename = decodeURIComponent(localReadMatch[2]);
      const commitId = url.searchParams.get("commit_id") || undefined;
      let data;
      try {
        data = await localWorkspaceService.readJsonFile(projectId, filename, commitId);
      } catch (error) {
        sendJson(res, 404, {
          error: error instanceof Error ? error.message : `File not found: ${filename}`,
        });
        return;
      }
      if (data === null) {
        sendJson(res, 404, { error: `Project not found: ${projectId}` });
        return;
      }

      sendJson(res, 200, { data });
      return;
    }

    if (url.pathname.startsWith("/api/xg/")) {
      const targetPath = url.pathname.replace("/api/xg/", "/xg/");
      const targetUrl = new URL(targetPath + url.search, XG_GATEWAY_URL);

      try {
        const bodyBuffer = await readRequestBodyBuffer(req);
        let proxyRes = await proxyRequest(
          targetUrl,
          req.method,
          buildGatewayProxyHeaders(req.headers, {
            host: targetUrl.host,
            apiKey: XG_GATEWAY_API_KEY,
          }),
          bodyBuffer,
        );

        if (shouldRetryWithServiceAuthFallback(req.headers, proxyRes.statusCode, XG_GATEWAY_API_KEY)) {
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

        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        res.end(proxyRes.body);
      } catch (err) {
        sendJson(res, 502, { error: "Gateway error", detail: err.message });
      }
      return;
    }

    if (url.pathname.startsWith("/api/probability/")) {
      const targetPath = url.pathname.replace("/api/probability/", "/probability/");
      const targetUrl = new URL(targetPath + url.search, XG_GATEWAY_URL);
      
      const proxyReq = httpRequest(targetUrl, {
        method: req.method,
        headers: buildGatewayProxyHeaders(req.headers, {
          host: targetUrl.host,
        }),
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });

      proxyReq.on("error", (err) => {
        sendJson(res, 502, { error: "Gateway error", detail: err.message });
      });

      req.pipe(proxyReq);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/ontologies") {
      sendJson(res, 200, await knowledgeBaseService.getOntologies());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/entities") {
      sendJson(res, 200, await knowledgeBaseService.listEntities());
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/entities/")) {
      const entityId = decodeURIComponent(url.pathname.replace("/api/entities/", ""));
      const detail = await knowledgeBaseService.getEntityDetail(entityId);

      if (!detail) {
        sendJson(res, 404, { error: `Entity not found: ${entityId}` });
        return;
      }

      sendJson(res, 200, detail);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/search") {
      const query = url.searchParams.get("q") || "";
      sendJson(res, 200, await knowledgeBaseService.searchEntities(query));
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

    if (req.method === "GET" && url.pathname === "/api/about") {
      sendJson(res, 200, await knowledgeBaseService.getAboutContent());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/editor/workspace") {
      sendJson(res, 200, await knowledgeBaseService.getEditorWorkspace(url.searchParams.get("entityId") || undefined));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/editor/preview") {
      const body = await parseBody(req);
      sendJson(res, 200, await knowledgeBaseService.previewEditorDraft({
        entityId: typeof body.entityId === "string" ? body.entityId : undefined,
        mode: typeof body.mode === "string" ? body.mode : "json",
        layer: typeof body.layer === "string" ? body.layer : undefined,
        slug: typeof body.slug === "string" ? body.slug : "",
        source: body.source,
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/editor/commit") {
      const body = await parseBody(req);
      sendJson(res, 200, await knowledgeBaseService.commitEditorDraft({
        entityId: typeof body.entityId === "string" ? body.entityId : undefined,
        mode: typeof body.mode === "string" ? body.mode : "json",
        projectId: typeof body.projectId === "string" ? body.projectId : "demo",
        layer: typeof body.layer === "string" ? body.layer : undefined,
        slug: typeof body.slug === "string" ? body.slug : "",
        message: typeof body.message === "string" ? body.message : "",
        source: body.source,
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await parseBody(req);
      const question = typeof body.question === "string" ? body.question.trim() : "";
      const entityId = typeof body.entityId === "string" ? body.entityId : undefined;
      const conversationId = typeof body.conversationId === "string" ? body.conversationId : undefined;
      const businessPrompt = typeof body.businessPrompt === "string" ? body.businessPrompt : undefined;
      const modelName = typeof body.modelName === "string" ? body.modelName : undefined;
      const requestConversationHistory = normalizeConversationHistoryForPrompt(body.conversationHistory);
      const persistedState = await assistantSessionStateService.load();
      const persistedConversationHistory = extractPersistedConversationHistory(
        persistedState,
        conversationId,
      );
      const conversationHistory = mergeConversationHistories(
        requestConversationHistory,
        persistedConversationHistory,
      );

      if (!question) {
        sendJson(res, 400, { error: "question is required" });
        return;
      }

      const context = await knowledgeBaseService.collectChatContext(question, entityId);
      const result = await qagentService.ask(question, context, {
        conversationId,
        businessPrompt,
        modelName,
        conversationHistory,
      });

      if (!result.ok) {
        sendJson(res, 502, {
          error: result.error,
          context,
          raw: result.raw,
          stderr: result.stderr,
        });
        return;
      }

      sendJson(res, 200, {
        answer: result.answer,
        context,
        raw: result.raw,
        stderr: result.stderr,
      });
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

      const runtimeRoot = qagentService.getConversationRuntimeRoot(conversationId);
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

    if (req.method === "POST" && url.pathname === "/api/chat/stream") {
      const body = await parseBody(req);
      const question = typeof body.question === "string" ? body.question.trim() : "";
      const entityId = typeof body.entityId === "string" ? body.entityId : undefined;
      const conversationId = typeof body.conversationId === "string" ? body.conversationId : undefined;
      const businessPrompt = typeof body.businessPrompt === "string" ? body.businessPrompt : undefined;
      const modelName = typeof body.modelName === "string" ? body.modelName : undefined;
      const requestConversationHistory = normalizeConversationHistoryForPrompt(body.conversationHistory);
      const persistedState = await assistantSessionStateService.load();
      const persistedConversationHistory = extractPersistedConversationHistory(
        persistedState,
        conversationId,
      );
      const conversationHistory = mergeConversationHistories(
        requestConversationHistory,
        persistedConversationHistory,
      );

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
        message: "已整理知识库上下文，准备连接 Agent CLI...",
      });

      try {
        const result = await qagentService.askStream(
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
            modelName,
            conversationHistory,
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
