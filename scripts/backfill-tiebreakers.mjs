import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const MELEE_CLIENT_ID = process.env.MELEE_API_CLIENT_ID;
const MELEE_CLIENT_SECRET = process.env.MELEE_API_CLIENT_SECRET;

if (!DATABASE_URL || !MELEE_CLIENT_ID || !MELEE_CLIENT_SECRET) {
  console.error("Missing DATABASE_URL / MELEE_API_CLIENT_ID / MELEE_API_CLIENT_SECRET");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 });
const AUTH_HEADER = "Basic " + Buffer.from(`${MELEE_CLIENT_ID}:${MELEE_CLIENT_SECRET}`).toString("base64");

const REQUEST_DELAY_MS = 250;

const parsePct = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const pickPct = (row, keys) => {
  for (const key of keys) {
    const val = parsePct(row?.[key]);
    if (val !== null) return val;
  }
  return null;
};

async function meleeGet(path, params = {}) {
  const url = new URL(`https://melee.gg${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url.toString(), { headers: { Authorization: AUTH_HEADER } });
  if (!res.ok) throw new Error(`Melee API ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchAllStandings(tid) {
  const all = [];
  let page = 1;
  while (true) {
    const data = await meleeGet(`/api/standing/list/current/${tid}`, {
      "variables.page": page,
      "variables.pageSize": 250,
    });
    const content = data?.Content ?? [];
    if (!Array.isArray(content) || content.length === 0) break;
    all.push(...content);
    if (!data?.HasMore) break;
    page += 1;
  }
  return all;
}

const tournaments = await sql`
  SELECT tid, tournament_name
  FROM tournaments
  WHERE tournament_name ILIKE '%Season%'
  ORDER BY start_date DESC
`;

console.log(`Backfilling tie-breakers for ${tournaments.length} season tournaments...`);

let tournamentsDone = 0;
let rowsUpdated = 0;

for (const t of tournaments) {
  try {
    const standings = await fetchAllStandings(t.tid);
    if (!standings.length) {
      console.log(`  [skip] ${t.tid} ${t.tournament_name} (no standings)`);
      continue;
    }

    for (const s of standings) {
      const playerName = s.Team?.Players?.[0]?.Name || s.Team?.Players?.[0]?.DisplayName || null;
      if (!playerName) continue;

      const omw = pickPct(s, ["OpponentMatchWinPercentage", "OMW", "OpponentsMatchWinPercentage"]);
      const tgw = pickPct(s, ["TeamGameWinPercentage", "PlayerGameWinPercentage", "TMW", "TGW"]);
      const ogw = pickPct(s, ["OpponentGameWinPercentage", "OpponentsGameWinPercentage", "OGW"]);

      if (omw === null && tgw === null && ogw === null) continue;

      const updated = await sql`
        UPDATE player_stats
        SET omw_pct = ${omw}, tgw_pct = ${tgw}, ogw_pct = ${ogw}
        WHERE tid = ${String(t.tid)} AND player_name = ${playerName}
      `;
      rowsUpdated += updated.count || 0;
    }

    tournamentsDone += 1;
    console.log(`  [ok] ${t.tid} ${t.tournament_name} (${standings.length} standings)`);
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  } catch (err) {
    console.log(`  [err] ${t.tid} ${t.tournament_name}: ${err.message}`);
  }
}

console.log(`Done. Tournaments processed: ${tournamentsDone}/${tournaments.length}, rows updated: ${rowsUpdated}`);
await sql.end();
