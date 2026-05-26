import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadAttachmentContent } from './admin.js';
import type { JiraClient } from './client.js';

const client: JiraClient = {
  baseURL: 'https://example.atlassian.net',
  email: 'test@example.com',
  apiToken: 'token',
};

interface CapturedRequest {
  url: string;
  method?: string;
  headers: Record<string, string>;
  redirect?: RequestRedirect;
}

function withFetchSequence(
  responses: Array<(input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>>,
): { restore: () => void; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const original = globalThis.fetch;
  let i = 0;
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
      headers,
      ...(init?.redirect !== undefined ? { redirect: init.redirect } : {}),
    });
    const responder = responses[i++];
    if (!responder) throw new Error('Unexpected extra fetch call');
    return responder(input, init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('downloadAttachmentContent: 200 OK returns body directly without following redirects', async () => {
  const stub = withFetchSequence([
    () => new Response(Buffer.from('hello world'), { status: 200 }),
  ]);
  try {
    const buf = await downloadAttachmentContent(client, 'att-1');
    assert.equal(buf.toString(), 'hello world');
    assert.equal(stub.calls.length, 1);
    assert.match(stub.calls[0]!.headers['authorization']!, /^Basic /);
    assert.equal(stub.calls[0]!.redirect, 'manual');
  } finally {
    stub.restore();
  }
});

test('downloadAttachmentContent: follows 303 redirect to CDN and drops auth header', async () => {
  const stub = withFetchSequence([
    () => new Response(null, { status: 303, headers: { location: 'https://cdn.atlassian.com/file/abc' } }),
    () => new Response(Buffer.from('cdn payload'), { status: 200 }),
  ]);
  try {
    const buf = await downloadAttachmentContent(client, 'att-1');
    assert.equal(buf.toString(), 'cdn payload');
    assert.equal(stub.calls.length, 2);
    assert.equal(stub.calls[1]!.url, 'https://cdn.atlassian.com/file/abc');
    assert.equal(stub.calls[1]!.headers['authorization'], undefined);
  } finally {
    stub.restore();
  }
});

test('downloadAttachmentContent: validateRedirectUrl=true allows the CDN fetch', async () => {
  const stub = withFetchSequence([
    () => new Response(null, { status: 303, headers: { location: 'https://cdn.atlassian.com/x' } }),
    () => new Response(Buffer.from('ok'), { status: 200 }),
  ]);
  try {
    const seen: string[] = [];
    const buf = await downloadAttachmentContent(client, 'att-1', {
      validateRedirectUrl: (url) => {
        seen.push(url);
        return true;
      },
    });
    assert.equal(buf.toString(), 'ok');
    assert.deepEqual(seen, ['https://cdn.atlassian.com/x']);
  } finally {
    stub.restore();
  }
});

test('downloadAttachmentContent: validateRedirectUrl=false aborts with allowlist error and skips CDN fetch', async () => {
  const stub = withFetchSequence([
    () => new Response(null, { status: 303, headers: { location: 'https://evil.example.com/secret' } }),
  ]);
  try {
    await assert.rejects(
      () => downloadAttachmentContent(client, 'att-1', { validateRedirectUrl: () => false }),
      /failed allowlist/,
    );
    assert.equal(stub.calls.length, 1, 'CDN fetch must not be issued when allowlist denies');
  } finally {
    stub.restore();
  }
});

test('downloadAttachmentContent: supports async validateRedirectUrl', async () => {
  const stub = withFetchSequence([
    () => new Response(null, { status: 303, headers: { location: 'https://cdn.atlassian.com/x' } }),
    () => new Response(Buffer.from('ok'), { status: 200 }),
  ]);
  try {
    const buf = await downloadAttachmentContent(client, 'att-1', {
      validateRedirectUrl: async (_url) => Promise.resolve(true),
    });
    assert.equal(buf.toString(), 'ok');
  } finally {
    stub.restore();
  }
});

test('downloadAttachmentContent: throws when 3xx redirect has no Location header', async () => {
  const stub = withFetchSequence([
    () => new Response(null, { status: 303 }),
  ]);
  try {
    await assert.rejects(() => downloadAttachmentContent(client, 'att-1'), /without Location header/);
  } finally {
    stub.restore();
  }
});

test('downloadAttachmentContent: throws on 4xx initial response', async () => {
  const stub = withFetchSequence([
    () => new Response('Not found', { status: 404, statusText: 'Not Found' }),
  ]);
  try {
    await assert.rejects(() => downloadAttachmentContent(client, 'att-1'), /404/);
  } finally {
    stub.restore();
  }
});

test('downloadAttachmentContent: throws when CDN returns non-2xx', async () => {
  const stub = withFetchSequence([
    () => new Response(null, { status: 303, headers: { location: 'https://cdn.atlassian.com/x' } }),
    () => new Response('Forbidden', { status: 403, statusText: 'Forbidden' }),
  ]);
  try {
    await assert.rejects(() => downloadAttachmentContent(client, 'att-1'), /CDN fetch failed: 403/);
  } finally {
    stub.restore();
  }
});
