import assert from "node:assert/strict";
import test from "node:test";

import { createAppServices } from "../createAppServices.mjs";

const WORKFLOW_ENV_NAMES = [
  "ONTOGIT_GATEWAY_URL",
  "XG_GATEWAY_URL",
  "GATEWAY_URL",
  "XG_GATEWAY_API_KEY",
  "GATEWAY_SERVICE_API_KEY",
  "ONTOGIT_AUTH_USERNAME",
  "XG_AUTH_USERNAME",
  "ONTOGIT_AUTH_PASSWORD",
  "XG_AUTH_PASSWORD",
  "WORKFLOW_LLM_API_KEY",
  "WORKFLOW_LLM_BASE_URL",
  "WORKFLOW_MODEL",
  "WORKFLOW_MODEL_A",
  "WORKFLOW_MODEL_B",
  "WORKFLOW_PARALLEL_COUNT",
  "WORKFLOW_DEBATE_ROUNDS",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_MODEL",
  "DMXAPI_API_KEY",
  "DMXAPI_BASE_URL",
  "DMXAPI_MODEL",
];

function withClearedEnv(names, callback) {
  const snapshot = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) {
    delete process.env[name];
  }

  try {
    return callback();
  } finally {
    for (const [name, value] of snapshot.entries()) {
      if (typeof value === "string") {
        process.env[name] = value;
      } else {
        delete process.env[name];
      }
    }
  }
}

test("createAppServices 使用 Windows 全局环境变量补齐 workflow LLM 配置", () => {
  withClearedEnv(WORKFLOW_ENV_NAMES, () => {
    const services = createAppServices({
      windowsEnvReader: () => ({
        WORKFLOW_LLM_API_KEY: "global-workflow-key",
        WORKFLOW_LLM_BASE_URL: "https://example.com/api/v1",
        WORKFLOW_MODEL_A: "openai/gpt-4.1-mini",
        WORKFLOW_MODEL_B: "openai/gpt-4.1-nano",
        WORKFLOW_PARALLEL_COUNT: "2",
        WORKFLOW_DEBATE_ROUNDS: "3",
      }),
    });

    assert.equal(services.workflowService.workflowLlmApiKey, "global-workflow-key");
    assert.equal(services.workflowService.workflowLlmBaseUrl, "https://example.com/api/v1");
    assert.equal(services.workflowService.workflowModel, "openai/gpt-4.1-mini");
    assert.equal(services.workflowService.workflowModelA, "openai/gpt-4.1-mini");
    assert.equal(services.workflowService.workflowModelB, "openai/gpt-4.1-nano");
    assert.equal(services.workflowService.workflowParallelCount, 2);
    assert.equal(services.workflowService.workflowDebateRounds, 3);
  });
});

test("createAppServices 使用 .agent/config.json 补齐 workflow LLM key", () => {
  withClearedEnv(WORKFLOW_ENV_NAMES, () => {
    const services = createAppServices({
      windowsEnvReader: () => ({}),
      agentConfigReader: () => ({
        model: {
          apiKey: "agent-config-key",
        },
      }),
    });

    assert.equal(services.workflowService.workflowLlmApiKey, "agent-config-key");
    assert.equal(services.workflowService.workflowLlmBaseUrl, "https://openrouter.ai/api/v1");
    assert.equal(services.workflowService.workflowModel, "deepseek/deepseek-v4-flash");
  });
});

test("createAppServices 默认指向远端 OntoGit gateway", () => {
  withClearedEnv(WORKFLOW_ENV_NAMES, () => {
    const services = createAppServices({
      windowsEnvReader: () => ({}),
      agentConfigReader: () => ({}),
    });

    assert.equal(services.workflowService.gatewayBaseUrl, "http://81.70.12.214:8080");
  });
});
