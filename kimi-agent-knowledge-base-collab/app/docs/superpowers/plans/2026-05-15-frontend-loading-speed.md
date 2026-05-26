# 前端加载速度优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 缩短从点击页面到首个可交互画面的时间，主要靠页面 chunk 预取、ontology 请求复用、状态派生降本，以及图谱渲染预算控制。

**Architecture:** 保持现有后端 API 和路由结构不变，只做前端侧分层。先把“下一页会用到的页面 chunk 和数据请求”提前热起来，再把图谱相关的派生状态改成索引式计算，最后给大图谱加一层降级渲染预算，避免首开时把主线程打满。

**Tech Stack:** React 19, TypeScript, Vite, node:test, tsx.

---

### Task 1: 导航预取与请求复用
**Files:**
- Modify: `src/app/AppShell.tsx`
- Modify: `src/features/ontology/api.ts`
- Modify: `src/hooks/useOntologyData.ts`
- Modify: `src/components/OntologyAssistant.tsx`
- Test: `src/features/ontology/api.test.ts`

- [ ] **Step 1: 写一个会失败的请求复用测试**

```ts
await prefetchKnowledgeGraph({ projectId: "demo" });
await fetchKnowledgeGraph({ projectId: "demo" });
assert.equal(fetchCount, 1);
```

这个测试要同时覆盖两件事：
- 同一个 `projectId` 的 ontology 请求会复用同一个 in-flight promise
- `prefetchKnowledgeGraphSlice(viewedRefs, projectId)` 先跑起来后，页面 mount 时不会再发第二次相同请求

- [ ] **Step 2: 先跑单测确认现在还没有这层复用**

Run: `npx tsx --test ./src/features/ontology/api.test.ts`

Expected: 失败，且失败点集中在“重复请求仍然触发了第二次 fetch”。

- [ ] **Step 3: 在 API 层加一个很薄的共享请求层**

在 `src/features/ontology/api.ts` 里新增模块级请求缓存，按以下粒度存 promise：
- `knowledge-graph + projectId + refresh`
- `knowledge-graph/slice + projectId + refsSignature`

然后在 `src/app/AppShell.tsx` 里给三个 Tab 入口加预取：
- `onMouseEnter`
- `onFocus`
- `requestIdleCallback` 兜底

预取动作只做两件事：
- `void import('@/app/pages/ExplorerPage')`
- `void import('@/app/pages/LabPage')`
- `void import('@/app/pages/AssistantPage')`

如果当前停留在 `assistant`，还要顺手预热 `viewedRefs` 对应的 `fetchKnowledgeGraphSlice`，这样聊天区和图谱区共用同一批数据时，不会因为切换消息或重渲染重复拉同一个 slice。

如果浏览器不支持 `requestIdleCallback`，就用 `setTimeout(..., 0)` 作为 fallback，不引入新依赖。

- [ ] **Step 4: 让 useOntologyData 直接复用预取中的 promise**

在 `src/hooks/useOntologyData.ts` 里保留当前 `enabled` 门控，但把首轮加载改成“优先复用共享 promise，再决定是否新发请求”。

目标行为是：
- 页面进入 `lab` / `explorer` 时不会再额外起第二次相同请求
- 页面离开后不会把缓存层弄复杂，只保留当前这轮会话内的 promise 复用
- 现有 `Promise.all([fetchKnowledgeGraph, fetchOntologies])` 的并行结构保持不变

`src/components/OntologyAssistant.tsx` 里已经在按 `viewedRefs` 拉 slice，所以这里也要接到同一层共享缓存，确保助手页、图谱页和预取阶段拿到的是同一个 in-flight 请求。

- [ ] **Step 5: 再跑单测和构建**

Run:
```bash
npx tsx --test ./src/features/ontology/api.test.ts
npm.cmd run build
```

Expected:
- `api.test.ts` 通过
- 构建通过
- 点击 tab 前就能把下一页的 chunk 热起来

---

### Task 2: 图谱状态派生瘦身
**Files:**
- Create: `src/features/ontology/stateSelectors.ts`
- Modify: `src/features/ontology/state.ts`
- Test: `tests/ontologyState.test.mjs`

- [ ] **Step 1: 增加一个能覆盖当前消费者的回归测试**

在 `tests/ontologyState.test.mjs` 里补一个 graph 样本，要求同时覆盖：
- 选中的实体不是首个可见实体
- 有跨层 relation，但只应保留可见层内部的边
- `relatedEntities` 的输出顺序与当前页面消费一致

这个测试的重点不是跑性能，而是把 refactor 前后的输出稳定住。

- [ ] **Step 2: 先跑现有状态测试，确认当前行为基线**

Run: `node --test ./tests/ontologyState.test.mjs`

Expected: 先记录当前输出，再开始 refactor，避免把性能优化和行为变更混在一起。

- [ ] **Step 3: 把状态派生拆成纯 selector**

新增 `src/features/ontology/stateSelectors.ts`，把下面这些计算移出去：
- `entityById`
- `visibleEntityById`
- `visibleCrossReferences`
- `selectedEntity`
- `relatedEntities`

`src/features/ontology/state.ts` 只保留一层组装，不再在多个地方重复 `Object.values(...).filter(...)` 和 `find(...)`。

具体目标：
- 全量实体只遍历一次
- 可见实体只做一次索引构建
- 相关实体查找改成 `Map` / `Set` 命中
- 页面消费的返回形状不变

- [ ] **Step 4: 用单测验证 refactor 没改坏输出**

Run:
```bash
node --test ./tests/ontologyState.test.mjs
npm.cmd run build
```

Expected:
- 断言全部通过
- 构建通过
- 大图谱情况下不会再在 state 派生上做重复全量扫描

---

### Task 3: 图谱渲染预算与渐进式展示
**Files:**
- Modify: `src/components/KnowledgeGraph.tsx`
- Modify: `src/components/knowledgeGraphLayout.ts`
- Modify: `src/app/pages/ExplorerPage.tsx`
- Modify: `src/app/pages/GraphPage.tsx` only if它仍然挂在真实路由上
- Test: `src/components/knowledgeGraphLayout.test.ts`

- [ ] **Step 1: 为渲染预算写一个纯函数测试**

在 `src/components/knowledgeGraphLayout.test.ts` 里补一个纯函数测试，覆盖两档模式：
- 小图谱走当前的 full layout
- 大图谱切到 reduced layout，并返回一个明确的首帧节点上限

推荐测试输入保持很小，但断言要明确：
- 节点数阈值
- 视口尺寸变化
- 返回的 mode / budget 不同

- [ ] **Step 2: 先跑布局测试，看当前实现还没有这层预算**

Run: `node --test ./src/components/knowledgeGraphLayout.test.ts`

Expected: 新增的预算测试先失败，说明还没有进入 reduced mode。

- [ ] **Step 3: 在 layout 层加预算，在渲染层加 deferred value**

在 `src/components/knowledgeGraphLayout.ts` 里新增一个纯 helper，负责决定：
- 当前图谱是 `full` 还是 `reduced`
- 首屏最多渲染多少个节点
- RAF 里是否允许双重循环斥力

在 `src/components/KnowledgeGraph.tsx` 里做三件事：
- 对 `entities` 和 `crossReferences` 使用 `useDeferredValue`
- 把节点索引缓存成 `ref`，不要每一帧都重新 `Map` 一次
- 当节点数超过阈值或页面不再激活时，提前停掉模拟循环

目标是让“先出壳，再慢慢收敛”，而不是等整张图完全算完才显示。

- [ ] **Step 4: 让 ExplorerPage 先显示可交互壳，再补全图**

在 `src/app/pages/ExplorerPage.tsx` 里保留现有 skeleton，但把图谱数据传递改成 deferred 版本。

如果 `GraphPage.tsx` 仍然被真实路由引用，再用同样的 deferred 策略；如果它只是遗留页面，就不要顺手重构它。

- [ ] **Step 5: 再跑布局测试和构建**

Run:
```bash
node --test ./src/components/knowledgeGraphLayout.test.ts
npm.cmd run build
```

Expected:
- 新的预算测试通过
- 构建通过
- 大图谱下不再一上来就把主线程的 force layout 打满

---

### Task 4: 端到端验收
**Files:** 无

- [ ] **Step 1: 跑全量前端与混合测试**

Run:
```bash
npm.cmd run test
npm.cmd run build
```

Expected:
- 前端相关测试通过
- 构建通过

- [ ] **Step 2: 做一次浏览器冷启动验收**

验收点只看三件事：
- 打开应用后，先看到 assistant shell，而不是立刻触发图谱重载
- 鼠标 hover 到 `本体库` / `本体图谱` / `问答助手` 时，chunk 预取开始
- 点击 `本体图谱` 后，首屏先稳定出现，图谱在后台逐步收敛，而不是等 force layout 彻底结束才显示

- [ ] **Step 3: 做一次中等规模图谱的性能对比**

对比 before / after 的 Performance trace，重点观察：
- 首屏主线程长任务是否减少
- tab 切换时是否少了一次重复请求
- 图谱首次渲染是否更早进入可交互状态

---

### Assumptions
- 保持现有 backend API 和数据结构不变。
- 不新增第三方依赖。
- 优先优化首开和 tab 切换感知速度，不追求一次性把整张图完全静态化。
- 小中等规模图谱的视觉风格尽量不变，只在大图谱时启用降级预算。
