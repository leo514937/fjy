import assert from "node:assert/strict";
import test from "node:test";

import { mergeExportContainers } from "../knowledgeDataMigration.mjs";

test("mergeExportContainers merges and resequences export snapshots by exported_at", () => {
  const merged = mergeExportContainers({
    projectId: "demo",
    filename: "wikimg_export.json",
    containers: [
      {
        history: [
          {
            sequence: 2,
            profile: "kimi",
            exported_at: "2026-04-17T21:44:30.208168+08:00",
            payload: { knowledgeGraph: { statistics: { total_entities: 11 } } },
          },
          {
            sequence: 3,
            profile: "kimi",
            exported_at: "2026-04-17T21:58:30.076831+08:00",
            payload: { knowledgeGraph: { statistics: { total_entities: 12 } } },
          },
          {
            sequence: 4,
            profile: "kimi",
            exported_at: "2026-04-17T22:00:16.000000+08:00",
            payload: { knowledgeGraph: { statistics: { total_entities: 13 } } },
          },
        ],
      },
      {
        history: [
          {
            sequence: 1,
            profile: "kimi",
            exported_at: "2026-04-17T17:25:03.870190+08:00",
            payload: { knowledgeGraph: { statistics: { total_entities: 8 } } },
          },
          {
            sequence: 2,
            profile: "kimi",
            exported_at: "2026-04-17T17:27:03.870190+08:00",
            payload: { knowledgeGraph: { statistics: { total_entities: 9 } } },
          },
          {
            sequence: 3,
            profile: "kimi",
            exported_at: "2026-04-17T17:29:03.870190+08:00",
            payload: { knowledgeGraph: { statistics: { total_entities: 10 } } },
          },
          {
            sequence: 4,
            profile: "kimi",
            exported_at: "2026-04-17T17:31:03.042125+08:00",
            payload: { knowledgeGraph: { statistics: { total_entities: 10 } } },
          },
        ],
      },
    ],
  });

  assert.equal(merged.schema_version, 1);
  assert.equal(merged.project_id, "demo");
  assert.equal(merged.filename, "wikimg_export.json");
  assert.equal(merged.history.length, 7);
  assert.deepEqual(
    merged.history.map((item) => item.sequence),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.deepEqual(
    merged.history.map((item) => item.exported_at),
    [
      "2026-04-17T17:25:03.870190+08:00",
      "2026-04-17T17:27:03.870190+08:00",
      "2026-04-17T17:29:03.870190+08:00",
      "2026-04-17T17:31:03.042125+08:00",
      "2026-04-17T21:44:30.208168+08:00",
      "2026-04-17T21:58:30.076831+08:00",
      "2026-04-17T22:00:16.000000+08:00",
    ],
  );
});
