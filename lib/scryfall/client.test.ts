import assert from "node:assert/strict";
import { test } from "node:test";

import { postCollectionWithRetry, retryAfterMs } from "./client";

test("retryAfterMs honours a Retry-After in seconds", () => {
  assert.equal(retryAfterMs("3", 0), 3000);
  assert.equal(retryAfterMs("0", 2), 0);
});

test("retryAfterMs caps Retry-After at a minute", () => {
  assert.equal(retryAfterMs("600", 0), 60_000);
});

test("retryAfterMs backs off exponentially without a usable header", () => {
  assert.equal(retryAfterMs(null, 0), 2000);
  assert.equal(retryAfterMs(null, 1), 4000);
  assert.equal(retryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT", 2), 8000);
  assert.equal(retryAfterMs(null, 10), 60_000);
});

function fakeFetch(statuses: number[]) {
  let calls = 0;
  const impl = (async () => {
    const status = statuses[Math.min(calls, statuses.length - 1)];
    calls++;
    return new Response("{}", { status });
  }) as typeof fetch;
  return { impl, calls: () => calls };
}

const noSleep = async () => {};

test("a 429 is waited out and the batch retried", async () => {
  const f = fakeFetch([429, 429, 200]);
  const res = await postCollectionWithRetry(["x"], {
    fetchImpl: f.impl,
    sleep: noSleep,
  });
  assert.equal(res.status, 200);
  assert.equal(f.calls(), 3);
});

test("gives up after the retry budget and returns the 429", async () => {
  const f = fakeFetch([429]);
  const res = await postCollectionWithRetry(["x"], {
    fetchImpl: f.impl,
    sleep: noSleep,
  });
  assert.equal(res.status, 429);
  assert.equal(f.calls(), 6);
});

test("other errors are not retried", async () => {
  const f = fakeFetch([500]);
  const res = await postCollectionWithRetry(["x"], {
    fetchImpl: f.impl,
    sleep: noSleep,
  });
  assert.equal(res.status, 500);
  assert.equal(f.calls(), 1);
});
