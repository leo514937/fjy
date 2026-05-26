import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AssistantMarkdown } from '../src/components/assistant/AssistantMarkdown';

test('AssistantMarkdown 正确渲染标题、加粗、列表、行内代码与代码块', () => {
  const html = renderToStaticMarkup(
    <AssistantMarkdown
      content={[
        '## 文件结构',
        '',
        '- **子文件夹**：用于存放资源',
        '- **文件**：用于定义入口',
        '',
        '请查看 `file_name`。',
        '',
        '```ts',
        'const answer = 42;',
        '```',
      ].join('\n')}
    />,
  );

  assert.match(html, /<h2[^>]*>文件结构<\/h2>/);
  assert.match(html, /<strong[^>]*>子文件夹<\/strong>/);
  assert.match(html, /<strong[^>]*>文件<\/strong>/);
  assert.match(html, /<ul[^>]*>/);
  assert.equal((html.match(/<li/g) || []).length, 2);
  assert.match(html, /<code[^>]*>file_name<\/code>/);
  assert.match(html, />复制<\/button>/);
  assert.match(html, />ts<\/span>/);
  assert.match(html, /const answer = 42;/);
});

test('AssistantMarkdown 正确渲染有序列表与引用', () => {
  const html = renderToStaticMarkup(
    <AssistantMarkdown
      content={[
        '1. 第一步',
        '2. 第二步',
        '',
        '> 这是引用内容',
      ].join('\n')}
    />,
  );

  assert.match(html, /<ol[^>]*>/);
  assert.equal((html.match(/<li/g) || []).length, 2);
  assert.match(html, /<blockquote[^>]*>/);
  assert.match(html, /这是引用内容/);
});
