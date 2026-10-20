import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import { createRateLimiter } from '../src/middleware/rateLimit.js';

function makeResponse() {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let body: unknown;
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return response;
    },
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(value: unknown) {
      body = value;
      return response;
    },
  } as unknown as Response;
  return {
    response,
    headers,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

test('throttles repeated requests and returns retry information', () => {
  let now = 1_000;
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 5,
    now: () => now,
  });
  const request = {
    ip: '203.0.113.10',
    socket: { remoteAddress: '203.0.113.10' },
  } as Request;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = makeResponse();
    let calledNext = false;
    limiter(request, result.response, () => {
      calledNext = true;
    });
    assert.equal(
      calledNext,
      true,
      `request ${attempt + 1} should be within the limit`,
    );
    assert.equal(
      result.headers.get('ratelimit-remaining'),
      String(4 - attempt),
    );
  }

  const limited = makeResponse();
  let calledNext = false;
  limiter(request, limited.response, () => {
    calledNext = true;
  });
  assert.equal(calledNext, false);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers.get('ratelimit-limit'), '5');
  assert.equal(limited.headers.get('ratelimit-remaining'), '0');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(
    (limited.body as { error: { code: string } }).error.code,
    'RATE_LIMITED',
  );

  now += 60_001;
  const reset = makeResponse();
  calledNext = false;
  limiter(request, reset.response, () => {
    calledNext = true;
  });
  assert.equal(
    calledNext,
    true,
    'the caller can make a new request after the window resets',
  );
});

test('keeps counters separate by caller IP', () => {
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 1,
    now: () => 2_000,
  });
  const first = {
    ip: '203.0.113.10',
    socket: { remoteAddress: '203.0.113.10' },
  } as Request;
  const second = {
    ip: '203.0.113.11',
    socket: { remoteAddress: '203.0.113.11' },
  } as Request;
  const firstResponse = makeResponse();
  const firstLimitedResponse = makeResponse();
  const secondResponse = makeResponse();
  let firstNext = 0;
  let firstLimitedNext = 0;
  let secondNext = 0;

  limiter(first, firstResponse.response, () => {
    firstNext += 1;
  });
  limiter(first, firstLimitedResponse.response, () => {
    firstLimitedNext += 1;
  });
  limiter(second, secondResponse.response, () => {
    secondNext += 1;
  });

  assert.equal(firstNext, 1);
  assert.equal(firstLimitedNext, 0);
  assert.equal(firstLimitedResponse.statusCode, 429);
  assert.equal(secondNext, 1);
  assert.equal(secondResponse.statusCode, 200);
});
