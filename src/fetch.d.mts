import type { NftItem } from "./index.mjs";
export type NftImage = { base64: string; mimeType: "image/png"; sha256: string };
export type FetchOptions = { signal?: AbortSignal; timeoutMs?: number; includeImage?: boolean };
export function fetchNft(value: string, options: FetchOptions & { includeImage: true }): Promise<NftItem & { image: NftImage }>;
export function fetchNft(value: string, options?: FetchOptions): Promise<NftItem & { image?: NftImage }>;
