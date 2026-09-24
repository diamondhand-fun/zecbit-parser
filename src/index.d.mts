export type ItemIdentity = { sourceUrl: string; collectionSlug: string; itemId: string };
export type NftItem = ItemIdentity & {
  name: string;
  collectionName: string;
  imageUrl: string;
  attributes: { trait: string; value: string }[];
  fetchedAt: string;
};
export const MAX_HTML_BYTES: number;
export function zecbitItem(value: string): ItemIdentity;
export function parseZecbit(html: string, source: string): NftItem;
