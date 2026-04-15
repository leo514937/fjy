import test from 'node:test';
import assert from 'node:assert/strict';

const executionStagesModuleUrl = new URL('../src/components/assistant/executionStages.ts', import.meta.url);

test('upsertExecutionStage 会在插入新阶段时自动收口上一阶段', async () => {
  const { upsertExecutionStage } = await import(executionStagesModuleUrl.href);

  const stages = upsertExecutionStage([], {
    id: 'stage-1',
    semanticStatus: 'thinking',
    label: '思考中...',
    phaseState: 'active',
    sourceEventType: 'request.started',
    detail: '准备连接 Agent',
    callId: null,
    startedAt: '2026-04-15T02:00:00.000Z',
    finishedAt: null,
  });
  const next = upsertExecutionStage(stages, {
    id: 'stage-2',
    semanticStatus: 'executing',
    label: '执行中...',
    phaseState: 'active',
    sourceEventType: 'tool.started',
    detail: 'dir',
    callId: 'tool-1',
    startedAt: '2026-04-15T02:00:02.000Z',
    finishedAt: null,
  });

  assert.equal(next.length, 2);
  assert.equal(next[0].phaseState, 'completed');
  assert.equal(next[0].finishedAt, '2026-04-15T02:00:02.000Z');
  assert.equal(next[1].semanticStatus, 'executing');
});

test('normalizeAssistantMessageStages 会为旧 toolRuns 生成更丰富的兼容阶段卡片', async () => {
  const { normalizeAssistantMessageStages } = await import(executionStagesModuleUrl.href);

  const normalized = normalizeAssistantMessageStages({
    id: 'message-legacy',
    question: '列出目录',
    answer: '已列出',
    relatedNames: [],
    executionStages: [
      {
        id: 'legacy-stage-tool-1',
        semanticStatus: 'completed',
        label: '执行结束...',
        phaseState: 'completed',
        sourceEventType: 'legacy.tool_run',
        detail: 'dir',
        callId: 'tool-1',
        startedAt: '2026-04-15T02:00:00.000Z',
        finishedAt: '2026-04-15T02:00:01.000Z',
      },
    ],
    toolRuns: [
      {
        callId: 'tool-1',
        command: 'dir',
        status: 'success',
        stdout: 'file-a\n',
        stderr: '',
        exitCode: 0,
        cwd: 'D:\\code\\FJY',
        durationMs: 32,
        truncated: false,
        startedAt: '2026-04-15T02:00:00.000Z',
        finishedAt: '2026-04-15T02:00:01.000Z',
      },
    ],
  });

  assert.equal(normalized.executionStages.length >= 4, true);
  assert.equal(normalized.executionStages[0].semanticStatus, 'thinking');
  assert.equal(normalized.executionStages.some((stage) => stage.semanticStatus === 'executing'), true);
  assert.equal(normalized.executionStages.some((stage) => stage.semanticStatus === 'observing'), true);
  assert.equal(normalized.executionStages.some((stage) => stage.semanticStatus === 'reasoning'), true);
  assert.equal(normalized.executionStages.at(-1)?.semanticStatus, 'completed');
  assert.equal(normalized.toolRuns.length, 1);
  assert.equal(normalized.toolRuns[0].callId, 'tool-1');
});
