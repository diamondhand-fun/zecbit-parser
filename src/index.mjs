import { parseHTML } from "linkedom";

export class ParserError extends Error {
  constructor(message, code) { super(message); this.name = "ParserError"; this.code = code; }
}

export const MAX_HTML_BYTES = 2_000_000;

export function zecbitItem(value) {
  if (typeof value !== "string" || value.length > 2048 || /[\x00-\x1f\x7f\\]/.test(value)) throw new ParserError("Invalid item URL.", "invalid_url");
  let url;
  try { url = new URL(value.trim()); } catch { throw new ParserError("Paste a Zecbit item URL.", "invalid_url"); }
  const path = /^\/item\/([a-z0-9][a-z0-9_-]{0,127})\/([1-9]\d{0,77})\/?$/.exec(url.pathname);
  if (url.protocol !== "https:" || url.hostname !== "zecbit.net" || url.port || url.username || url.password || !path)
    throw new ParserError("Use https://zecbit.net/item/collection/item-id.", "invalid_url");
  return { sourceUrl: `https://zecbit.net/item/${path[1]}/${path[2]}`, collectionSlug: path[1], itemId: path[2] };
}

export function parseZecbit(html, source) {
  if (typeof html !== "string" || html.length > MAX_HTML_BYTES || new TextEncoder().encode(html).length > MAX_HTML_BYTES)
    throw new ParserError("HTML exceeds 2 MB or is not a string.", "invalid_html");
  const identity = zecbitItem(source);
  const { document } = parseHTML(html);
  let base;
  try { base = new URL(document.querySelector("base[href]")?.getAttribute("href") ?? identity.sourceUrl, identity.sourceUrl).href; }
  catch { throw new ParserError("Invalid document base URL.", "invalid_metadata"); }
  for (const link of document.querySelectorAll('link[rel~="canonical"]')) {
    let declared;
    try { declared = zecbitItem(new URL(link.getAttribute("href"), base).href).sourceUrl; } catch { /* Reject invalid declarations below. */ }
    if (declared !== identity.sourceUrl) throw new ParserError("Page canonical URL does not match the requested NFT.", "source_mismatch");
  }
  for (const node of document.querySelectorAll("script, style, template")) node.remove();
  const main = document.querySelector("main");
  const name = main?.querySelector("h1")?.textContent?.trim();
  const collectionLink = Array.from(main?.querySelectorAll("a[href]") ?? []).find(link => {
    try {
      const url = new URL(link.getAttribute("href"), base);
      return url.origin === "https://zecbit.net" && !url.username && !url.password && url.pathname.replace(/\/$/, "") === `/collection/${identity.collectionSlug}`;
    } catch { return false; }
  });
  const collection = collectionLink?.textContent?.replace(/^←\s*/, "").trim();
  const imagePath = `/api/art/${identity.collectionSlug}/${identity.itemId}`;
  const image = Array.from(main?.querySelectorAll("img") ?? []).find((img) => {
    try { const url = new URL(img.getAttribute("src") ?? "", base); return url.origin === "https://zecbit.net" && !url.username && !url.password && url.pathname === imagePath; } catch { return false; }
  });
  if (!name || !collection || !image || name.length > 256 || collection.length > 256)
    throw new ParserError("Zecbit did not return a readable NFT. Try again later.", "invalid_metadata");
  const attributes = Array.from(main.querySelectorAll("table tr")).slice(0, 64).flatMap((row) => {
    const cells = row.querySelectorAll("td");
    const trait = Array.from(cells[0]?.textContent?.trim() ?? "").slice(0, 128).join("");
    const value = Array.from(cells[1]?.textContent?.trim() ?? "").slice(0, 256).join("");
    return trait && value ? [{ trait, value }] : [];
  });
  return { ...identity, name, collectionName: collection, imageUrl: `https://zecbit.net${imagePath}`, attributes, fetchedAt: new Date().toISOString() };
}
