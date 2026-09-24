import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceQuota, importLimits, finishQuota } from "../src/quota.mjs";

const now = 1_800_000_000_000;

test("request quotas enforce minute/day limits and reset at UTC boundaries", () => {
  let state;
  for (let i = 0; i < 100; i++) {
    const result = advanceQuota(state, "request", now + Math.floor(i / 10) * 60_000, "");
    assert(result.ok);
    state = result.state;
    if (i === 9) assert.deepEqual(advanceQuota(state, "request", now, ""), {
      ok: false, error: "Too many imports (10 per minute per wallet).", retryAfter: 60,
    });
  }
  assert.equal(advanceQuota(state, "request", now + 600_000, "").ok, false);
  const nextDay = advanceQuota(state, "request", now + 86_400_000, "");
  assert(nextDay.ok);
  assert.equal(nextDay.state.requests, 1);
  assert.equal(nextDay.quota.requestsRemaining, 99);
});

test("fresh imports preserve saved state, enforce lease, cooldown and daily cap", () => {
  let state;
  for (let i = 0; i < 5; i++) {
    const result = advanceQuota(state && Object.freeze(state), "fresh", now + i * 31_000, String(i));
    assert(result.ok);
    assert.equal(result.state.lease, String(i));
    assert.notEqual(result.state, state);
    state = result.state;
  }
  assert.equal(advanceQuota(state, "fresh", now + 155_000, "next").ok, false);
  const first = advanceQuota(undefined, "fresh", now, "lease").state;
  assert.equal(advanceQuota(first, "fresh", now + 1, "next").retryAfter, 30);
  const finished = { ...first, leaseUntil: 0, lease: undefined };
  assert.equal(advanceQuota(finished, "fresh", now + 1, "next").retryAfter, 20);
  assert(advanceQuota(finished, "fresh", now + 20_000, "next").ok);
  assert(advanceQuota(state, "fresh", now + 86_400_000, "next").ok);
});

test("upstream budget and pause are separate from cached request allowance", () => {
  let state;
  for (let i = 0; i < importLimits.upstreamDay; i++) {
    const result = advanceQuota(state, "upstream", now, "");
    assert(result.ok);
    state = result.state;
  }
  assert.equal(advanceQuota(state, "upstream", now, "").ok, false);
  const paused = { ...state, pausedUntil: now + 300_000 };
  assert.equal(advanceQuota(paused, "upstream", now, "").retryAfter, 300);
  assert(advanceQuota(paused, "request", now, "").ok);
  const boundary = (state.day + 1) * 86_400_000;
  assert.equal(advanceQuota({ ...state, pausedUntil: boundary + 30_000 }, "upstream", boundary, "").retryAfter, 30);
});

test("reject malformed operations and lease identifiers", () => {
  for (const [kind, time, lease] of [["other", now, ""], ["fresh", now, ""], ["fresh", now, {}], ["request", NaN, ""], ["request", -1, ""], ["request", Number.MAX_SAFE_INTEGER, ""]]) {
    assert.throws(() => advanceQuota(undefined, kind, time, lease), /Invalid quota/);
  }
});

test("clock rollback and damaged persisted state cannot reset an allowance", () => {
  const state = advanceQuota(undefined, "request", now, "").state;
  assert.equal(advanceQuota(state, "request", now - 60_000, "").ok, false);
  for (const patch of [{ requests: NaN }, { fresh: -1 }, { minuteRequests: undefined }]) {
    assert.throws(() => advanceQuota({ ...state, ...patch }, "request", now, ""), /saved quota state/);
  }
});


test("complete only the owning lease and refund a same-day unstarted attempt once", () => {
  const state = Object.freeze(advanceQuota(undefined, "fresh", now, "owner").state);
  assert.equal(finishQuota(state, "stale", { refund: true, now }), state);
  const done = finishQuota(state, "owner", { refund: true, now });
  assert.equal(done.fresh, 0);
  assert.equal(done.leaseUntil, 0);
  assert.equal(done.nextStart, state.nextStart);
  assert.equal(finishQuota(done, "owner", { refund: true, now }), done);
  assert.equal(finishQuota(state, "owner", { refund: true, now: now + 86_400_000 }).fresh, 1);
  assert.equal(state.fresh, 1);
});
