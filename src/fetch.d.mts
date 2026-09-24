import type { NftItem } from "./index.mjs";
export function fetchNft(value: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<NftItem>;
