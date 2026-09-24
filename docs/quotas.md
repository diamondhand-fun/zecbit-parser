# Import quotas

`src/quota.mjs` contains the pure state transition from Diamond Hand's import
service. It does not store state, verify wallets or acquire a distributed lock.
Pass a trusted saved state and server timestamp; persist an accepted result
atomically before starting work. Never accept state or time from a client.

```js
import { advanceQuota } from "../src/quota.mjs";

const result = advanceQuota(undefined, "fresh", Date.now(), crypto.randomUUID());
if (result.ok) {
  console.log(result.state, result.quota);
} else {
  console.log(result.error, result.retryAfter);
}
```

| Operation | Budget | State key |
| --- | --- | --- |
| `request` | 10 per UTC minute, 100 per UTC day | Per wallet |
| `fresh` | 5 attempts per UTC day, 20-second cooldown, 30-second lease | Same wallet |
| `upstream` | 100 attempts per UTC day | Separate shared key |

`request` counts all imports, including cache hits. Call `fresh` only on cache
misses, then `upstream` before contacting the source. Cached reads can continue
while fresh upstream requests are paused. This is a fixed-window limiter;
bursts across minute boundaries can exceed 10 requests in a rolling minute.

On success, the returned `state` is a new object. The input is never mutated.
On denial, no state is returned: keep the saved value. `retryAfter` is seconds,
rounded up, with a minimum of one. Invalid operation, timestamp or fresh lease
identifier throws instead of consuming a budget. Damaged stored counters also
throw; a server clock rollback into an older minute denies the operation rather
than resetting its allowance. `quota` reports wallet limits for `request` and `fresh`. For `upstream`, it
returns `upstreamRemaining` and `resetsAt`, reflecting the shared 100-attempt
budget rather than the five-attempt wallet budget.

## Storage integration

Run read → transition → write as one serialized operation per state key.
In the application this happens inside a Cloudflare Durable Object with
synchronous storage. A read and later asynchronous write without a transaction
will race and is not sufficient.

At completion, persist `finishQuota(saved, lease, { refund, now })` within the
same serialized storage operation. Only the owning lease is cleared, and
repeated completion cannot refund twice or clear a newer lease. Refunds apply
only on the attempt's UTC day. The cooldown
remains in force after completion. Refund `fresh` only when no upstream
attempt started, under the same serialized storage operation.

When the source blocks requests, set the shared state's `pausedUntil` to
`now + importLimits.failureMs`. Pause and lease deadlines survive UTC-day
resets; request and fresh counters reset. Wallet authentication, persistence,
lease completion and circuit-breaker storage remain the caller's responsibility.

Persisted state fails closed on inconsistent UTC buckets, out-of-range counters
or missing lease ownership. Use `undefined` only for a genuinely absent record;
`null`, `false` and malformed stored data are errors rather than quota resets.
Lease completion rejects clock rollback instead of refunding against stale time.

On `source_blocked`, persist `pauseQuota(state, Date.now())` in the same storage
transaction used for quota updates. It pauses fresh and shared upstream attempts
for five minutes, preserves counters and leases, and never shortens an existing
pause. Cached request allowance remains available.
