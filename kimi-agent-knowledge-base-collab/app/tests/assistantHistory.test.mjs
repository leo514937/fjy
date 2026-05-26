import test from "node:test";
import assert from "node:assert/strict";
import { importAppModule } from "./testPaths.mjs";

test("助手历史搜索会匹配标题与消息内容", async () => {
  const { filterAssistantSessions } = await importAppModule("src", "components", "assistant", "history.ts");

  const sessions = [
    {
      id: "s1",
      title: "光照监测",
      messages: [{ question: "怎么接 onenet", answer: "先看设备接入" }],
    },
    {
      id: "s2",
      title: "投喂控制",
      messages: [{ question: "阈值怎么设", answer: "参考传感器历史数据" }],
    },
  ];

  assert.deepEqual(
    filterAssistantSessions(sessions, "onenet").map((session) => session.id),
    ["s1"],
  );

  assert.deepEqual(
    filterAssistantSessions(sessions, "投喂").map((session) => session.id),
    ["s2"],
  );

  assert.equal(filterAssistantSessions(sessions, "").length, 2);
});
