export type QuotaState = {
  day: number; minute: number; requests: number; minuteRequests: number;
  fresh: number; leaseUntil: number; nextStart: number; pausedUntil: number; lease?: string;
};
export type WalletQuota = { requestsRemaining: number; freshRemaining: number; resetsAt: number };
export type UpstreamQuota = { upstreamRemaining: number; resetsAt: number };
export type QuotaResult<Q = WalletQuota | UpstreamQuota> =
  | { ok: true; state: QuotaState; quota: Q }
  | { ok: false; error: string; retryAfter: number };
export const importLimits: Readonly<{ minute: number; day: number; fresh: number; upstreamDay: number; leaseMs: number; cooldownMs: number; failureMs: number }>;
export function advanceQuota(saved: QuotaState | undefined, kind: "request" | "fresh", now: number, lease: string): QuotaResult<WalletQuota>;
export function advanceQuota(saved: QuotaState | undefined, kind: "upstream", now: number, lease: string): QuotaResult<UpstreamQuota>;
export function advanceQuota(saved: QuotaState | undefined, kind: "request" | "fresh" | "upstream", now: number, lease: string): QuotaResult;
export function finishQuota(saved: QuotaState | undefined, lease: string, options?: { refund?: boolean; now?: number }): QuotaState | undefined;
