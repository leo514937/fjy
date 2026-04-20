import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ChatArea } from '../src/components/assistant/ChatArea';

test('ChatArea 会按时间顺序交错渲染 assistant、tool_call 和 tool_result', () => {
  const html = renderToStaticMarkup(
    <ChatArea
      activeSession={{
        title: '测试对话',
        messages: [
          {
            id: 'm1',
            question: '帮我看看仓库结构',
            answer: '我已经整理好仓库结构了。',
            relatedNames: [],
            contentBlocks: [
              {
                id: 'block-assistant-1',
                type: 'assistant',
                content: '我先检查一下目录结构。',
                createdAt: '2026-04-18T09:00:00.000Z',
                completedAt: '2026-04-18T09:00:00.500Z',
                phase: 'completed',
              },
              {
                id: 'block-tool-call-1',
                type: 'tool_call',
                callId: 'call-1',
                command: 'rg --files .',
                reasoning: '先列出仓库文件，确认主要目录',
                createdAt: '2026-04-18T09:00:01.000Z',
              },
              {
                id: 'block-tool-result-1',
                type: 'tool_result',
                callId: 'call-1',
                command: 'rg --files .',
                status: 'success',
                stdout: 'src/App.tsx\nsrc/main.tsx\n',
                stderr: '',
                exitCode: 0,
                cwd: '/Users/qiuboyu/CodeLearning/new_fjy/fjy',
                durationMs: 88,
                createdAt: '2026-04-18T09:00:01.088Z',
                finishedAt: '2026-04-18T09:00:01.088Z',
              },
              {
                id: 'block-assistant-2',
                type: 'assistant',
                content: '我已经整理好仓库结构了。',
                createdAt: '2026-04-18T09:00:02.000Z',
                completedAt: '2026-04-18T09:00:02.500Z',
                phase: 'completed',
              },
            ],
            executionStages: [],
            toolRuns: [
              {
                callId: 'call-1',
                command: 'rg --files .',
                status: 'success',
                stdout: 'src/App.tsx\nsrc/main.tsx\n',
                stderr: '',
                exitCode: 0,
                cwd: '/Users/qiuboyu/CodeLearning/new_fjy/fjy',
                durationMs: 88,
                truncated: false,
                startedAt: '2026-04-18T09:00:00.000Z',
                finishedAt: '2026-04-18T09:00:00.088Z',
              },
            ],
          },
        ],
        draftQuestion: '',
        loading: false,
        error: null,
        statusMessage: null,
      }}
      onAsk={() => {}}
      onStop={() => {}}
      onDraftChange={() => {}}
      isBusy={false}
      selectedEntityName="实体"
    />,
  );

  assert.match(html, /帮我看看仓库结构/);
  assert.match(html, /我先检查一下目录结构。/);
  assert.match(html, /tool_call/);
  assert.match(html, /tool_result/);
  assert.match(html, /先列出仓库文件，确认主要目录/);
  assert.match(html, /rg --files \./);
  assert.match(html, /src\/App\.tsx/);
  assert.match(html, /exit 0/);
  assert.match(html, /我已经整理好仓库结构了。/);
  assert.equal(html.indexOf('我先检查一下目录结构。') < html.indexOf('tool_call'), true);
  assert.equal(html.indexOf('tool_call') < html.indexOf('tool_result'), true);
  assert.equal(html.indexOf('tool_result') < html.lastIndexOf('我已经整理好仓库结构了。'), true);
});

