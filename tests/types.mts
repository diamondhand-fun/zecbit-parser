import { parseZecbit, type NftItem } from "@diamondhand-fun/zecbit-parser";
import { fetchNft } from "@diamondhand-fun/zecbit-parser/fetch";
import { advanceQuota, finishQuota } from "@diamondhand-fun/zecbit-parser/quota";
import { readText } from "@diamondhand-fun/zecbit-parser/http";
const item: NftItem = parseZecbit("", "");
const id: string = item.itemId;
const download: Promise<NftItem> = fetchNft("", { signal: AbortSignal.timeout(10) });
const text: Promise<string> = readText(new Response(""), 10);
const result = advanceQuota(undefined, "upstream", Date.now(), "");
if (result.ok) {
  const remaining: number = result.quota.upstreamRemaining;
  finishQuota(result.state, "lease");
  // @ts-expect-error The upstream result is not a wallet budget.
  result.quota.freshRemaining;
}
// @ts-expect-error Fetch options require an AbortSignal.
fetchNft("", { signal: "cancel" });
// @ts-expect-error HTML must be a string.
parseZecbit(12, "");
