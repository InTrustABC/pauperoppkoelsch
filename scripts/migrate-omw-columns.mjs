import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

await sql`ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS omw_pct REAL`;
await sql`ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS tgw_pct REAL`;
await sql`ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS ogw_pct REAL`;

console.log("Added columns (if missing): omw_pct, tgw_pct, ogw_pct");

await sql.end();
