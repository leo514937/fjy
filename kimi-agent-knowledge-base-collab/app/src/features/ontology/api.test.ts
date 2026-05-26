import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchKnowledgeGraph,
  fetchKnowledgeGraphSlice,
  fetchOntologies,
  prefetchKnowledgeGraph,
  prefetchKnowledgeGraphSlice,
  prefetchOntologies,
} from '@/features/ontology/api';

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function installFetchTrap() {
  const originalFetch = globalThis.fetch;
  const requests: Array<{
    input: RequestInfo | URL;
    init?: RequestInit;
    resolve: (response: Response) => void;
  }> = [];

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve) => {
    requests.push({ input, init, resolve });
  })) as typeof fetch;

  return {
    requests,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test('prefetchKnowledgeGraph 与 fetchKnowledgeGraph 复用同一个 in-flight 请求', async () => {
  const trap = installFetchTrap();
  try {
    const prefetchPromise = prefetchKnowledgeGraph({ projectId: 'demo' });

    assert.equal(trap.requests.length, 1);
    trap.requests[0].resolve(createJsonResponse({
      metadata: {
        title: '知识图谱',
        version: '1.0.0',
        description: '测试数据',
      },
      statistics: {
        total_entities: 1,
        total_relations: 0,
        domains: ['demo'],
        levels: [1],
        layers: ['common'],
        layer_counts: { common: 1 },
      },
      entity_index: {},
      cross_references: [],
    }));

    const prefetched = await prefetchPromise;
    const fetchPromise = fetchKnowledgeGraph({ projectId: 'demo' });
    assert.equal(trap.requests.length, 1);
    const fetched = await fetchPromise;

    assert.equal(trap.requests.length, 1);
    assert.equal(prefetched.metadata.title, '知识图谱');
    assert.equal(fetched.statistics.total_entities, 1);
  } finally {
    trap.restore();
  }
});

test('fetchKnowledgeGraph 的 refresh 会覆盖已解析缓存', async () => {
  const trap = installFetchTrap();
  try {
    const projectId = 'demo-refresh';
    const firstPromise = prefetchKnowledgeGraph({ projectId });

    assert.equal(trap.requests.length, 1);
    trap.requests[0].resolve(createJsonResponse({
      metadata: {
        title: '知识图谱',
        version: '1.0.0',
        description: '旧数据',
      },
      statistics: {
        total_entities: 1,
        total_relations: 0,
        domains: ['demo'],
        levels: [1],
        layers: ['common'],
        layer_counts: { common: 1 },
      },
      entity_index: {},
      cross_references: [],
    }));

    await firstPromise;

    const refreshPromise = fetchKnowledgeGraph({ refresh: true, projectId });
    assert.equal(trap.requests.length, 2);
    trap.requests[1].resolve(createJsonResponse({
      metadata: {
        title: '知识图谱',
        version: '2.0.0',
        description: '新数据',
      },
      statistics: {
        total_entities: 2,
        total_relations: 1,
        domains: ['demo'],
        levels: [1, 2],
        layers: ['common'],
        layer_counts: { common: 2 },
      },
      entity_index: {},
      cross_references: [],
    }));

    const refreshed = await refreshPromise;
    const cachedAgain = await fetchKnowledgeGraph({ projectId });

    assert.equal(trap.requests.length, 2);
    assert.equal(refreshed.metadata.version, '2.0.0');
    assert.equal(cachedAgain.statistics.total_entities, 2);
  } finally {
    trap.restore();
  }
});

test('prefetchOntologies 与 fetchOntologies 复用同一个 in-flight 请求', async () => {
  const trap = installFetchTrap();
  try {
    const prefetchPromise = prefetchOntologies();

    assert.equal(trap.requests.length, 1);
    trap.requests[0].resolve(createJsonResponse({
      philosophicalOntology: {
        metadata: {
          title: '哲学本体',
          created_by: 'test',
          version: '1.0.0',
          description: '测试数据',
        },
      },
      formalOntology: {
        metadata: {
          title: '形式本体',
          created_by: 'test',
          version: '1.0.0',
          description: '测试数据',
        },
      },
      scientificOntology: {
        metadata: {
          title: '科学本体',
          created_by: 'test',
          version: '1.0.0',
          description: '测试数据',
        },
      },
    }));

    const prefetched = await prefetchPromise;
    const fetchPromise = fetchOntologies();
    assert.equal(trap.requests.length, 1);
    const fetched = await fetchPromise;

    assert.equal(trap.requests.length, 1);
    assert.equal(prefetched.philosophicalOntology.metadata.title, '哲学本体');
    assert.equal(fetched.scientificOntology.metadata.title, '科学本体');
  } finally {
    trap.restore();
  }
});

test('prefetchKnowledgeGraphSlice 与 fetchKnowledgeGraphSlice 复用同一个 in-flight 请求', async () => {
  const trap = installFetchTrap();
  try {
    const refs = ['entity-1', 'entity-2'];
    const prefetchPromise = prefetchKnowledgeGraphSlice(refs, 'demo');

    assert.equal(trap.requests.length, 1);
    trap.requests[0].resolve(createJsonResponse({
      viewedRefs: refs,
      missingRefs: [],
      entities: [],
      crossReferences: [],
    }));

    const prefetched = await prefetchPromise;
    const fetchPromise = fetchKnowledgeGraphSlice(refs, 'demo');
    assert.equal(trap.requests.length, 1);
    const fetched = await fetchPromise;

    assert.equal(trap.requests.length, 1);
    assert.deepEqual(prefetched.viewedRefs, refs);
    assert.deepEqual(fetched.missingRefs, []);
  } finally {
    trap.restore();
  }
});
