import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addIssueWatcher, removeIssueWatcher, getIssueWatchers } from './issues.js';
import type { JiraClient } from './client.js';

const client: JiraClient = {
  baseURL: 'https://example.atlassian.net',
  email: 'test@example.com',
  apiToken: 'token',
};

interface CapturedRequest {
  url: string;
  method?: string;
  body?: string;
  headers: Record<string, string>;
}

function withFetchStub(
  responder: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
): { restore: () => void; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((v, k) => {
        headers[k] = v;
      });
    }
    calls.push({
      url: typeof input === 'string' ? input : input.toString(),
      method: init?.method,
      body: typeof init?.body === 'string' ? init.body : undefined,
      headers,
    });
    return responder(input, init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test('addIssueWatcher: body is the accountId as a single JSON-quoted string (CCE-1140 regression)', async () => {
  const stub = withFetchStub(() => new Response(null, { status: 204 }));
  try {
    await addIssueWatcher(client, 'PROJ-1', '712020:abcd-1234');
    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0]!;
    assert.equal(call.method, 'POST');
    assert.equal(call.url, 'https://example.atlassian.net/rest/api/3/issue/PROJ-1/watchers');
    assert.equal(call.body, '"712020:abcd-1234"');
    assert.notEqual(call.body, '"\\"712020:abcd-1234\\""');
    assert.equal(JSON.parse(call.body!), '712020:abcd-1234');
  } finally {
    stub.restore();
  }
});

test('addIssueWatcher: succeeds on Jira 204 No Content response', async () => {
  const stub = withFetchStub(() => new Response(null, { status: 204 }));
  try {
    await assert.doesNotReject(() => addIssueWatcher(client, 'PROJ-1', '712020:user'));
  } finally {
    stub.restore();
  }
});

test('addIssueWatcher: surfaces Jira 404 errors (e.g. unknown user / no permission)', async () => {
  const stub = withFetchStub(
    () => new Response('User not found', { status: 404, statusText: 'Not Found' }),
  );
  try {
    await assert.rejects(() => addIssueWatcher(client, 'PROJ-1', '712020:nope'), /404/);
  } finally {
    stub.restore();
  }
});

test('removeIssueWatcher: passes accountId as query param, not body', async () => {
  const stub = withFetchStub(() => new Response(null, { status: 204 }));
  try {
    await removeIssueWatcher(client, 'PROJ-1', '712020:abcd');
    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0]!;
    assert.equal(call.method, 'DELETE');
    assert.match(call.url, /accountId=712020%3Aabcd/);
    assert.equal(call.body, undefined);
  } finally {
    stub.restore();
  }
});

test('getIssueWatchers: GETs the watchers endpoint and parses the response', async () => {
  const stub = withFetchStub(
    () =>
      new Response(
        JSON.stringify({
          self: 'https://example.atlassian.net/rest/api/3/issue/PROJ-1/watchers',
          isWatching: false,
          watchCount: 1,
          watchers: [{ accountId: '712020:user', displayName: 'Test User', active: true }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  try {
    const result = await getIssueWatchers(client, 'PROJ-1');
    assert.equal(stub.calls[0]!.method, 'GET');
    assert.equal(result.watchCount, 1);
    assert.equal(result.watchers?.[0]?.accountId, '712020:user');
  } finally {
    stub.restore();
  }
});
