# 图谱斥力空间分桶优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把知识图谱里最重的 O(n²) 斥力计算改成“精确小图 + 空间分桶大图”的混合策略，在不改变图谱整体长相和交互手感的前提下，继续降低大图谱的主线程压力。

**Architecture:** 保留现有的节点生成、连线合并、拖拽、缩放和中心回拉逻辑，只替换 RAF 里的斥力 pair 来源。新建一个纯 helper 专门负责“空间分桶 + 邻域枚举”，`KnowledgeGraph.tsx` 只负责决定何时用 exact、何时用 spatial，并把同一套 repulsion 常量继续沿用。推荐先用统一网格（uniform grid），不要直接上 quadtree：网格实现更短、可预测性更强，也更容易保持当前布局风格不变。

**Tech Stack:** React 19, TypeScript, Vite, node:test, tsx.

---

### Task 1: 提取空间分桶 helper
**Files:**
- Create: `src/components/knowledgeGraphSpatialIndex.ts`
- Test: `src/components/knowledgeGraphSpatialIndex.test.ts`

- [ ] **Step 1: 先写一个会失败的 helper 测试**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import type { KnowledgeGraphNode } from './knowledgeGraphLayout';
import {
  buildKnowledgeGraphSpatialIndex,
  forEachKnowledgeGraphNeighborPair,
  getKnowledgeGraphRepulsionStrategy,
} from './knowledgeGraphSpatialIndex';

function createNode(id: string, x: number, y: number): KnowledgeGraphNode {
  return {
    id,
    name: id,
    x,
    y,
    vx: 0,
    vy: 0,
    radius: 20,
    color: '#666666',
    entity: {
      id,
      name: id,
      type: 'capability',
      domain: 'demo-domain',
      layer: 'domain',
      level: 2,
      source: 'test',
      definition: id,
      properties: {},
    },
  };
}

test('getKnowledgeGraphRepulsionStrategy 在 64 个节点及以下保持 exact', () => {
  assert.deepEqual(getKnowledgeGraphRepulsionStrategy(64), {
    mode: 'exact',
    cellSize: 0,
    neighborSpan: 0,
  });
});

test('forEachKnowledgeGraphNeighborPair 只遍历同桶和邻桶节点对', () => {
  const nodes = [
    createNode('a', 10, 10),
    createNode('b', 48, 18),
    createNode('c', 260, 24),
    createNode('d', 760, 24),
  ];
  const index = buildKnowledgeGraphSpatialIndex(nodes, 240);
  const pairs: Array<[string, string]> = [];

  forEachKnowledgeGraphNeighborPair(nodes, index, 1, (sourceNode, targetNode) => {
    pairs.push([sourceNode.id, targetNode.id]);
  });

  assert.deepEqual(pairs, [
    ['a', 'b'],
    ['a', 'c'],
    ['b', 'c'],
  ]);
});

test('120 个节点时候选对数量明显少于全量 pairwise', () => {
  const nodes = Array.from({ length: 120 }, (_, index) =>
    createNode(`n-${index}`, (index % 12) * 80, Math.floor(index / 12) * 80),
  );
  const index = buildKnowledgeGraphSpatialIndex(nodes, 240);
  const pairs: Array<[KnowledgeGraphNode, KnowledgeGraphNode]> = [];

  forEachKnowledgeGraphNeighborPair(nodes, index, 1, (sourceNode, targetNode) => {
    pairs.push([sourceNode, targetNode]);
  });

  const fullPairCount = (nodes.length * (nodes.length - 1)) / 2;
  assert.ok(pairs.length < fullPairCount / 3);
});
```

这个测试先把三件事钉住：
- 小图仍然走 exact，不提前改图谱风格
- 分桶邻域遍历只看同桶和邻桶，不再全量 pairwise
- 大图的候选对数量要显著低于全量组合数

- [ ] **Step 2: 先跑测试确认现在还没有这层 helper**

Run: `node --test ./src/components/knowledgeGraphSpatialIndex.test.ts`

Expected: 失败，提示 `buildKnowledgeGraphSpatialIndex` / `forEachKnowledgeGraphNeighborPair` / `getKnowledgeGraphRepulsionStrategy` 还未实现。

- [ ] **Step 3: 实现空间分桶 helper**

在 `src/components/knowledgeGraphSpatialIndex.ts` 里新增下面这组导出，并把规则写死成常量，后面调参只改这一处：

```ts
export const KNOWLEDGE_GRAPH_SPATIAL_CELL_SIZE = 240;
export const KNOWLEDGE_GRAPH_SPATIAL_NEIGHBOR_SPAN = 1;
export const KNOWLEDGE_GRAPH_SPATIAL_EXACT_THRESHOLD = 64;

export interface KnowledgeGraphSpatialIndex {
  cellSize: number;
  buckets: Map<string, number[]>;
}

export interface KnowledgeGraphRepulsionStrategy {
  mode: 'exact' | 'spatial';
  cellSize: number;
  neighborSpan: number;
}
```

实现目标是：
- `getKnowledgeGraphRepulsionStrategy(nodeCount)` 在 `nodeCount <= 64` 时返回 `exact`
- `nodeCount > 64` 时返回 `spatial`
- `buildKnowledgeGraphSpatialIndex(nodes, cellSize)` 只做一次分桶，不在 pair 循环里重复算格子坐标
- `forEachKnowledgeGraphNeighborPair(...)` 只枚举同桶和周边桶里的节点对，并且避免重复 pair

- [ ] **Step 4: 再跑一次测试**

Run:
```bash
node --test ./src/components/knowledgeGraphSpatialIndex.test.ts
```

Expected:
- 3 个断言通过
- 不再出现全量 pairwise 的枚举开销

---

### Task 2: 把 RAF 里的斥力替换成 exact/spatial 混合策略
**Files:**
- Modify: `src/components/KnowledgeGraph.tsx`
- Modify: `src/components/knowledgeGraphLayout.test.ts` 仅在需要补 repulsion 策略回归时

- [ ] **Step 1: 先写一个会失败的集成级回归点**

把 `src/components/knowledgeGraphLayout.test.ts` 里补一个只检查策略分流的测试，确保不会把小图也误切到 spatial：

```ts
import { getKnowledgeGraphRepulsionStrategy } from './knowledgeGraphSpatialIndex';

test('getKnowledgeGraphRepulsionStrategy 会在中小图保持 exact', () => {
  assert.deepEqual(getKnowledgeGraphRepulsionStrategy(40), {
    mode: 'exact',
    cellSize: 0,
    neighborSpan: 0,
  });

  assert.deepEqual(getKnowledgeGraphRepulsionStrategy(120), {
    mode: 'spatial',
    cellSize: 240,
    neighborSpan: 1,
  });
});
```

这个测试的目的不是测性能，而是锁住分流规则，防止后面把阈值改歪。

- [ ] **Step 2: 先跑回归测试确认当前还没有分流逻辑**

Run: `node --test ./src/components/knowledgeGraphLayout.test.ts`

Expected: 新增的策略测试先失败，说明 `KnowledgeGraph` 还没有接入 spatial repulsion。

- [ ] **Step 3: 在 KnowledgeGraph 的 RAF 里接入 spatial pair 枚举**

把 `src/components/KnowledgeGraph.tsx` 里的这段：

```ts
for (let i = 0; i < nextNodes.length; i += 1) {
  for (let j = i + 1; j < nextNodes.length; j += 1) {
    // 现有斥力计算
  }
}
```

替换成混合策略：

```ts
const strategy = getKnowledgeGraphRepulsionStrategy(nextNodes.length);

if (strategy.mode === 'exact') {
  for (let i = 0; i < nextNodes.length; i += 1) {
    for (let j = i + 1; j < nextNodes.length; j += 1) {
      const sourceNode = nextNodes[i];
      const targetNode = nextNodes[j];
      // 保持当前 repulsionStrength / distance / damping 逻辑不变
    }
  }
} else {
  const spatialIndex = buildKnowledgeGraphSpatialIndex(nextNodes, strategy.cellSize);

  forEachKnowledgeGraphNeighborPair(nextNodes, spatialIndex, strategy.neighborSpan, (sourceNode, targetNode) => {
    // 仍然使用同一套 repulsionStrength / distance / damping 常量
    // 只替换 pair 的来源，不改最终力学公式
  });
}
```

同时保留下面这些行为不动：
- link spring 仍然全量计算
- center pull 仍然全量计算
- drag 时的节点固定逻辑不变
- zoom / pan 不变
- selected node 高亮不变

这一步的关键是把“pair 的来源”换掉，而不是把整张图的物理规则换掉。

- [ ] **Step 4: 去掉前一版为了止血加的 repulsion 降频**

当 spatial pair 枚举已经接上后，把之前那种按帧跳过一半 repulsion 的节流删掉，避免图谱在大图时出现“隔帧抖动”或者局部先塌缩再展开的手感问题。

- [ ] **Step 5: 再跑构建和回归测试**

Run:
```bash
node --test ./src/components/knowledgeGraphLayout.test.ts
npm.cmd run build
```

Expected:
- 策略测试通过
- 构建通过
- 小图视觉不变，大图只是在更少的 pair 上做同一套力学计算

---

### Task 3: 大图性能验收与阈值微调
**Files:**
- Modify: `src/components/knowledgeGraphSpatialIndex.ts` 仅在阈值需要微调时
- Test: `src/components/knowledgeGraphSpatialIndex.test.ts`

- [ ] **Step 1: 先把当前阈值和候选对数量固定下来**

如果 120+ 节点图谱在本地 trace 里仍然过重，就先只调这三个常量，不动别的逻辑：

```ts
export const KNOWLEDGE_GRAPH_SPATIAL_CELL_SIZE = 240;
export const KNOWLEDGE_GRAPH_SPATIAL_NEIGHBOR_SPAN = 1;
export const KNOWLEDGE_GRAPH_SPATIAL_EXACT_THRESHOLD = 64;
```

调整顺序只允许这样走：
- 先把 `neighborSpan` 从 `1` 提到 `2`
- 如果视觉还是太散，再把 `EXACT_THRESHOLD` 从 `64` 提到 `72` 或 `80`
- 只有当图谱明显仍然卡顿时，才考虑进一步增大 `cellSize`

不允许的做法：
- 回退到全量 pairwise
- 为了省算力再把节点隐藏或抽样
- 改变节点外观、标签规则、连线样式

- [ ] **Step 2: 做一次本地性能对比**

Run:
```bash
npm.cmd run build
node --test ./src/components/knowledgeGraphSpatialIndex.test.ts
```

然后在浏览器里验证两组图谱：
- 40 节点左右：图谱长相和当前版本保持一致
- 120 节点以上：主线程里斥力计算的长任务明显减少，节点不会再因为全量 pairwise 卡成一团

验收时只看三件事：
- 图谱没有“塌成球”或者“拉成一条线”
- 拖拽还是顺手
- 大图的首次收敛更快，但不会改变视觉风格

---

### Assumptions
- 保持现有图谱数据结构、节点样式和交互不变。
- 只优化斥力 pair 的枚举方式，不改 link spring、中心回拉和拖拽逻辑。
- 先采用统一网格分桶，不引入 quadtree 或新依赖。
- 小图优先保持 exact，优化收益主要来自大图。
