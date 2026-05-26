import test from "node:test";
import assert from "node:assert/strict";
import { runTypeScriptCheck } from "./testPaths.mjs";

test("OntologyAssistant 相关组件可以通过独立类型检查", () => {
  assert.doesNotThrow(() => {
    runTypeScriptCheck("tests/tsconfig.ontologyAssistant.json");
  });
});
