import test from "node:test";
import assert from "node:assert/strict";

const { formatWorkspaceError } = await import("../src/features/workspace/errors.ts");

test("workspace error message 会保留后端返回并附加提示", () => {
  const message = formatWorkspaceError(
    new Error("请稍后重试"),
    "获取项目列表失败",
    "常见原因：demo 项目未初始化",
  );

  assert.equal(message, "请稍后重试（常见原因：demo 项目未初始化）");
});

test("workspace error message 会展示具体错误细节", () => {
  const message = formatWorkspaceError(
    new Error("backend returned HTTP 404: 项目 demo 不存在"),
    "获取项目列表失败",
    "常见原因：demo 项目未初始化",
  );

  assert.equal(message, "backend returned HTTP 404: 项目 demo 不存在（常见原因：demo 项目未初始化）");
});
