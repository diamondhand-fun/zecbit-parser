const importLimits = Object.freeze({ minute: 10, day: 100, fresh: 5, upstreamDay: 100, leaseMs: 3e4, cooldownMs: 2e4, failureMs: 5 * 6e4 });
function advanceQuota(saved, kind, now, lease) {
  if (!["request", "fresh", "upstream"].includes(kind) || !Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - 864e5 || kind === "fresh" && (typeof lease !== "string" || !lease || lease.length > 128)) throw new Error("Invalid quota operation.");
  const day = Math.floor(now / 864e5), minute = Math.floor(now / 6e4);
  const state = {
    day,
    minute,
    requests: saved?.day === day ? saved.requests : 0,
    minuteRequests: saved?.minute === minute ? saved.minuteRequests : 0,
    fresh: saved?.day === day ? saved.fresh : 0,
    leaseUntil: saved?.leaseUntil ?? 0,
    nextStart: saved?.nextStart ?? 0,
    pausedUntil: saved?.pausedUntil ?? 0,
    lease: saved?.lease
  };
  const denied = (error, until) => ({ ok: false, error, retryAfter: Math.max(1, Math.ceil((until - now) / 1e3)) });
  if (kind === "request") {
    if (state.requests >= importLimits.day) return denied("Daily import request limit reached (100 per wallet).", (day + 1) * 864e5);
    if (state.minuteRequests >= importLimits.minute) return denied("Too many imports (10 per minute per wallet).", (minute + 1) * 6e4);
    state.requests++;
    state.minuteRequests++;
  } else {
    const global = kind === "upstream", cap = global ? importLimits.upstreamDay : importLimits.fresh;
    if (state.pausedUntil > now) return denied("Zecbit is temporarily blocking imports. Cached NFTs remain available.", state.pausedUntil);
    if (!global && state.leaseUntil > now) return denied("This wallet already has an NFT import in progress.", state.leaseUntil);
    if (!global && state.nextStart > now) return denied("Please wait before loading another new NFT.", state.nextStart);
    if (state.fresh >= cap) return denied(global ? "Today's shared import budget is used. Cached NFTs remain available." : "Daily new NFT attempt limit reached (5 per wallet).", (day + 1) * 864e5);
    state.fresh++;
    if (!global) {
      state.lease = lease;
      state.leaseUntil = now + importLimits.leaseMs;
      state.nextStart = now + importLimits.cooldownMs;
    }
  }
  return { ok: true, state, quota: { requestsRemaining: importLimits.day - state.requests, freshRemaining: Math.max(0, importLimits.fresh - state.fresh), resetsAt: (day + 1) * 864e5 } };
}
export {
  advanceQuota,
  importLimits
};
