import { fetchNft } from "./fetch.mjs";

try {
  if (process.argv.length !== 3) throw new Error("Usage: npm run --silent fetch -- <zecbit-item-url>");
  console.log(JSON.stringify(await fetchNft(process.argv[2]), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
