import test from 'node:test';
import assert from 'node:assert/strict';
import { sendChatCompletion } from './modelClient';
import type { RetryNotice } from './modelClient';

test('retryUntilSuccess uses 3-second reconnect interval for upstream errors', async () => {
  const originalFetch = global.fetch;
  const abortController = new AbortController();
  const notices: RetryNotice[] = [];

  global.fetch = (async () => new Response(
    '{"error":{"message":"upstream failed"}}',
    {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    },
  )) as typeof fetch;

  try {
    await assert.rejects(
      sendChatCompletion(
        'http://127.0.0.1:8123/v1/chat/completions',
        'api-key',
        'test-model',
        [{ role: 'user', content: 'ping' }],
        {
          signal: abortController.signal,
          retryUntilSuccess: true,
          onRetry: (notice) => {
            notices.push(notice);
            abortController.abort();
          },
        },
      ),
      /Задача остановлена пользователем/,
    );

    assert.equal(notices.length, 1);
    assert.equal(notices[0].status, 502);
    assert.equal(notices[0].delayMs, 3_000);
    assert.equal(notices[0].retryUntilSuccess, true);
  } finally {
    global.fetch = originalFetch;
  }
});
