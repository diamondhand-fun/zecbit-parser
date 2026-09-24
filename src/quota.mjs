function validateState(saved) {
  if (saved === undefined) return;
  if (!saved || typeof saved !== "object" || Array.isArray(saved) ||
      !["day", "minute", "requests", "minuteRequests", "fresh", "leaseUntil", "nextStart", "pausedUntil"].every(key => Number.isSafeInteger(saved[key]) && saved[key] >= 0) ||
      saved.minute > Math.floor(Number.MAX_SAFE_INTEGER / 60_000) || saved.day !== Math.floor(saved.minute / 1440) ||
      saved.requests > importLimits.day || saved.minuteRequests > importLimits.minute || saved.minuteRequests > saved.requests || saved.fresh > importLimits.upstreamDay ||
      saved.lease !== undefined && (typeof saved.lease !== "string" || !saved.lease || saved.lease.length > 128) || saved.leaseUntil > 0 && saved.lease === undefined)
    throw new Error("Invalid saved quota state.");
}

const importLimits = Object.freeze({ minute: 10, day: 100, fresh: 5, upstreamDay: 100, leaseMs: 3e4, cooldownMs: 2e4, failureMs: 5 * 6e4 });
function advanceQuota(saved, kind, now, lease) {
  if (!["request", "fresh", "upstream"].includes(kind) || !Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - 864e5 || kind === "fresh" && (typeof lease !== "string" || !lease || lease.length > 128)) throw new Error("Invalid quota operation.");
  validateState(saved);
  if (saved && now < saved.minute * 60_000) return { ok: false, error: "Server clock moved backwards. Retry shortly.", retryAfter: Math.max(1, Math.ceil((saved.minute * 60_000 - now) / 1000)) };
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
  return { ok: true, state, quota: kind === "upstream"
    ? { upstreamRemaining: Math.max(0, importLimits.upstreamDay - state.fresh), resetsAt: (day + 1) * 864e5 }
    : { requestsRemaining: importLimits.day - state.requests, freshRemaining: Math.max(0, importLimits.fresh - state.fresh), resetsAt: (day + 1) * 864e5 } };
}
export {
  advanceQuota,
  importLimits
};

export function finishQuota(saved, lease, { refund = false, now = Date.now() } = {}) {
  validateState(saved);
  if (typeof lease !== "string" || !lease || typeof refund !== "boolean" || !Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - 864e5 || saved && now < saved.minute * 60_000) throw new Error("Invalid quota completion.");
  if (!saved || saved.lease !== lease) return saved;
  return { ...saved, lease: undefined, leaseUntil: 0,
    fresh: refund && saved.day === Math.floor(now / 86_400_000) ? Math.max(0, saved.fresh - 1) : saved.fresh };
}

/** Pause fresh/upstream traffic after an access denial; cached reads stay available. */
export function pauseQuota(saved, now = Date.now()) {
  validateState(saved);
  if (!saved || !Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - importLimits.failureMs || now < saved.minute * 60_000) throw new Error("Invalid quota pause.");
  return { ...saved, pausedUntil: Math.max(saved.pausedUntil, now + importLimits.failureMs) };
}
