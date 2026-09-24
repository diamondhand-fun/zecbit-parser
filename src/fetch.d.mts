import type { NftItem } from "./index.mjs";
export function fetchNft(value: string, options?: { signal?: AbortSignal }): Promise<NftItem>;
