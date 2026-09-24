import { fetchNft } from "./fetch.mjs";

try {
  if (["--help", "-h"].includes(process.argv[2]) && process.argv.length === 3) {
    console.log("Usage: npm run --silent fetch -- <zecbit-item-url>");
  } else {
  if (process.argv.length !== 3) throw new Error("Usage: npm run --silent fetch -- <zecbit-item-url>");
  console.log(JSON.stringify(await fetchNft(process.argv[2]), null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
