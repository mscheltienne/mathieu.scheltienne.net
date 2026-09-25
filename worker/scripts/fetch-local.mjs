// Local development helper: fetch the data with a token read from a file, and
// write the public payload (identical to the Worker's /data.json) to a file.
//
//   node scripts/fetch-local.mjs <token-file> <output.json>
//
// The token is only read from the file and passed to the GitHub API; it is
// never printed or written anywhere.
import { readFile, writeFile } from "node:fs/promises";
import config from "../config.json" with { type: "json" };
import { fetchActivity } from "../src/github.js";
import { publicData } from "../src/public.js";

const [tokenFile, output] = process.argv.slice(2);
if (!tokenFile || !output) {
  console.error("usage: node scripts/fetch-local.mjs <token-file> <output.json>");
  process.exit(2);
}

const token = (await readFile(tokenFile, "utf8")).trim();
const data = publicData(await fetchActivity({ token, ...config }));
await writeFile(output, JSON.stringify(data, null, 2));

const { days, ...contributions } = data.contributions;
console.log(JSON.stringify({ ...data, contributions: { ...contributions, days: `${days.length} days` } }, null, 2));
