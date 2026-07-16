import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

const [t] = await sql`
  SELECT tid, tournament_name
  FROM tournaments
  WHERE tournament_name ILIKE '%Verdant Season%'
  ORDER BY start_date DESC
  LIMIT 1
`;

if (!t) {
  console.log("No Verdant Season tournament found.");
  await sql.end();
  process.exit(1);
}

const url = new URL(`https://melee.gg/api/standing/list/current/${t.tid}`);
url.searchParams.set("variables.page", "1");
url.searchParams.set("variables.pageSize", "1");

const auth =
  "Basic " +
  Buffer.from(
    `${process.env.MELEE_API_CLIENT_ID}:${process.env.MELEE_API_CLIENT_SECRET}`,
  ).toString("base64");

const res = await fetch(url.toString(), {
  headers: { Authorization: auth },
});

const json = await res.json();
const row = json?.Content?.[0] ?? json?.content?.[0] ?? null;

console.log("TOURNAMENT", t.tid, t.tournament_name);
console.log("HTTP", res.status);
console.log("TOP_KEYS", Object.keys(json));

if (!row) {
  console.log("NO_ROW", JSON.stringify(json).slice(0, 1200));
  await sql.end();
  process.exit(0);
}

const keys = Object.keys(row);
console.log("ROW_KEYS", keys);

const matching = keys.filter((k) =>
  /omw|tgw|tmw|ogw|matchwin|gamewin|tie/i.test(k),
);
console.log("MATCHING_KEYS", matching);

for (const k of matching) {
  console.log(`FIELD ${k} =`, row[k]);
}

await sql.end();
