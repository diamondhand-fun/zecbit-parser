/** Read a Fetch API body within a byte limit, preserving split UTF-8 characters. */
export async function readText(message, limit, { signal, fatal = false } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Invalid byte limit.");
  if (typeof fatal !== "boolean") throw new Error("Invalid UTF-8 decoding option.");
  signal?.throwIfAborted();
  if (!message.body) throw new Error("Empty response.");
  const reader = message.body.getReader();
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal });
  let size = 0, text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > limit) throw new Error("Response exceeds the size limit.");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {}); // Cleanup must not delay failure on an oversized body.
    reader.releaseLock();
  }
}
