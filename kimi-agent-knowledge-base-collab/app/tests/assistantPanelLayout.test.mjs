import test from "node:test";
import assert from "node:assert/strict";
import { importAppModule } from "./testPaths.mjs";

test("问答助手主内容区使用聊天区与执行流两栏布局", async () => {
  const { ASSISTANT_PANEL_LAYOUT } = await importAppModule("src", "components", "assistant", "panelLayout.ts");

  assert.deepEqual(ASSISTANT_PANEL_LAYOUT, {
    chat: {
      defaultSize: 'calc(100% - 18rem)',
      minSize: '16rem',
    },
    flow: {
      defaultSize: '18rem',
      minSize: '14rem',
      maxSize: '22rem',
    },
  });
});
