import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, put, deleteWithBody, patch } from './client.js';
import type { JiraClient } from './client.js';

const client: JiraClient = {
  baseURL: 'https://example.atlassian.net',
  email: 'test@example.com',
  apiToken: 'token',
};

function withFetchStub(
  responder: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
): { restore: () => void } {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    responder(input, init)) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test('post: 201 Created with empty body returns null (CCE-1140 createIssueLink regression)', async () => {
  const stub = withFetchStub(() => new Response('', { status: 201 }));
  try {
    const result = await post(client, '/rest/api/3/issueLink', {});
    assert.equal(result, null);
  } finally {
    stub.restore();
  }
});

test('post: 200 OK with empty body returns null', async () => {
  const stub = withFetchStub(() => new Response('', { status: 200 }));
  try {
    const result = await post(client, '/rest/api/3/anything', {});
    assert.equal(result, null);
  } finally {
    stub.restore();
  }
});

test('post: 204 No Content returns null (existing behavior preserved)', async () => {
  const stub = withFetchStub(() => new Response(null, { status: 204 }));
  try {
    const result = await post(client, '/rest/api/3/anything', {});
    assert.equal(result, null);
  } finally {
    stub.restore();
  }
});

test('post: parses non-empty JSON body normally', async () => {
  const stub = withFetchStub(
    () =>
      new Response(JSON.stringify({ key: 'PROJ-1', id: '12345' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  try {
    const result = await post<{ key: string; id: string }>(client, '/rest/api/3/issue', {});
    assert.deepEqual(result, { key: 'PROJ-1', id: '12345' });
  } finally {
    stub.restore();
  }
});

test('get: 200 OK with empty body returns null', async () => {
  const stub = withFetchStub(() => new Response('', { status: 200 }));
  try {
    const result = await get(client, '/rest/api/3/anything');
    assert.equal(result, null);
  } finally {
    stub.restore();
  }
});

test('put: 200 OK with empty body returns null', async () => {
  const stub = withFetchStub(() => new Response('', { status: 200 }));
  try {
    const result = await put(client, '/rest/api/3/anything', {});
    assert.equal(result, null);
  } finally {
    stub.restore();
  }
});

test('patch: 200 OK with empty body returns null', async () => {
  const stub = withFetchStub(() => new Response('', { status: 200 }));
  try {
    const result = await patch(client, '/rest/api/3/anything', {});
    assert.equal(result, null);
  } finally {
    stub.restore();
  }
});

test('deleteWithBody: 200 OK with empty body returns null', async () => {
  const stub = withFetchStub(() => new Response('', { status: 200 }));
  try {
    const result = await deleteWithBody(client, '/rest/api/3/anything', {});
    assert.equal(result, null);
  } finally {
    stub.restore();
  }
});

test('post: surfaces 4xx errors normally', async () => {
  const stub = withFetchStub(
    () =>
      new Response(JSON.stringify({ errorMessages: ['Bad request'] }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  try {
    await assert.rejects(() => post(client, '/rest/api/3/anything', {}), /API error 400/);
  } finally {
    stub.restore();
  }
});
