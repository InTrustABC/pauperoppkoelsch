/**
 * find-duplicates.mjs — One-time script to detect potential duplicate player names.
 * Run: node --env-file=.env scripts/find-duplicates.mjs
 */
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const sql = postgres(DATABASE_URL, { prepare: false, max: 1, idle_timeout: 10 });

const rows = await sql`SELECT DISTINCT player_name FROM player_stats ORDER BY player_name`;
const names = rows.map(r => r.player_name);

console.log(`Total distinct player names: ${names.length}\n`);

// --- 1. Case-insensitive duplicates ---
const caseMap = new Map();
for (const name of names) {
  const key = name.toLowerCase().trim();
  if (!caseMap.has(key)) caseMap.set(key, []);
  caseMap.get(key).push(name);
}
const caseDupes = [...caseMap.entries()].filter(([, v]) => v.length > 1);
if (caseDupes.length) {
  console.log("=== Case-insensitive duplicates ===");
  for (const [, variants] of caseDupes) console.log("  ", variants.join(" | "));
  console.log();
}

// --- 2. Similar names (Levenshtein distance ≤ 3 or one is substring of other) ---
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

console.log("=== Similar names (Levenshtein ≤ 3, excluding case dupes) ===");
const lowerNames = names.map(n => n.toLowerCase().trim());
const alreadyReported = new Set(caseDupes.map(([k]) => k));
const similarPairs = [];

for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const a = lowerNames[i], b = lowerNames[j];
    if (a === b) continue; // already caught by case check
    if (alreadyReported.has(a) && alreadyReported.has(b)) continue;
    const dist = levenshtein(a, b);
    if (dist <= 3 || a.includes(b) || b.includes(a)) {
      similarPairs.push([names[i], names[j], dist]);
    }
  }
}
for (const [a, b, d] of similarPairs.sort((x, y) => x[2] - y[2])) {
  console.log(`  "${a}" <-> "${b}" (dist=${d})`);
}

// --- 3. Same last name with different first name variants ---
console.log("\n=== Shared last name (potential aliases) ===");
const lastNameMap = new Map();
for (const name of names) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].toLowerCase();
    if (!lastNameMap.has(last)) lastNameMap.set(last, []);
    lastNameMap.get(last).push(name);
  }
}
for (const [last, group] of [...lastNameMap.entries()].sort()) {
  if (group.length > 1) console.log(`  [${last}]: ${group.join(" | ")}`);
}

console.log("\n=== All player names ===");
for (const name of names) console.log(`  ${name}`);

await sql.end();
