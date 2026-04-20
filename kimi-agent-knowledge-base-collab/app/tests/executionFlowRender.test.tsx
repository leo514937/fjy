import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ExecutionFlow } from '../src/components/assistant/ExecutionFlow';

test('ExecutionFlow 优先展示语义状态和阶段明细', () => {
  const html = renderToStaticMarkup(
    <ExecutionFlow
      executionStages={[
        {
          id: 'stage-1',
          semanticStatus: 'thinking',
          label: '思考中...',
          phaseState: 'completed',
          sourceEventType: 'status.changed',
          detail: '正在整理上下文',
          callId: null,
          startedAt: '2026-04-15T02:00:00.000Z',
          finishedAt: '2026-04-15T02:00:01.000Z',
        },
        {
          id: 'stage-2',
          semanticStatus: 'observing',
          label: '观察中...',
          phaseState: 'completed',
          sourceEventType: 'tool.output.delta',
          detail: '正在读取命令输出',
          callId: 'tool-1',
          startedAt: '2026-04-15T02:00:02.000Z',
          finishedAt: '2026-04-15T02:00:03.000Z',
          toolRun: {
            callId: 'tool-1',
            command: 'dir',
            status: 'success',
            stdout: 'file-a\n',
            stderr: '',
            exitCode: 0,
            cwd: 'D:\\code\\FJY',
            durationMs: 128,
            truncated: false,
            startedAt: '2026-04-15T02:00:02.000Z',
            finishedAt: '2026-04-15T02:00:03.000Z',
          },
        },
      ]}
    />,
  );

  assert.match(html, /思考中\.\.\./);
  assert.match(html, /观察中\.\.\./);
  assert.match(html, /正在整理上下文/);
  assert.match(html, /0.13s/);
  assert.doesNotMatch(html, />success</);
});
