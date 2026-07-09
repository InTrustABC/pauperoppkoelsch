import postgres from "postgres";
import { readFileSync } from "fs";

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const aliases = JSON.parse(readFileSync("scripts/lib/archetype-aliases.json", "utf-8"));

console.log("Applying archetype aliases to database...\n");

// Delete meta_snapshots first — we'll rebuild after
await sql.unsafe("DELETE FROM meta_snapshots");

for (const [from, to] of Object.entries(aliases)) {
    // Check if any rows use this alias
    const rows = await sql.unsafe(`SELECT count(*) as c FROM player_stats WHERE deck_archetype = $1`, [from]);
    const count = parseInt(rows[0].c);
    if (count === 0) continue;

    // Ensure target archetype exists
    await sql.unsafe(`INSERT INTO deck_archetypes (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [to]);

    // Update player_stats
    await sql.unsafe(`UPDATE player_stats SET deck_archetype = $1 WHERE deck_archetype = $2`, [to, from]);

    console.log(`  ${from} → ${to} (${count} rows)`);
}

// Clean up orphaned archetypes
await sql.unsafe(`
    DELETE FROM deck_archetypes
    WHERE name NOT IN (SELECT DISTINCT deck_archetype FROM player_stats WHERE deck_archetype IS NOT NULL)
      AND name NOT IN (SELECT DISTINCT deck_archetype FROM meta_snapshots)
`);

console.log("\n✅ Done. Refreshing meta snapshots...");

// Refresh meta snapshots
await sql.unsafe("DELETE FROM meta_snapshots");
await sql.unsafe(`
    INSERT INTO deck_archetypes (name)
    SELECT DISTINCT deck_archetype FROM player_stats
    WHERE deck_archetype IS NOT NULL
    ON CONFLICT (name) DO NOTHING
`);
await sql.unsafe(`
    INSERT INTO meta_snapshots (snapshot_date, tid, deck_archetype, count, percentage_of_field, player_count)
    SELECT
      TO_TIMESTAMP(t.start_date)::date AS snapshot_date,
      ps.tid, ps.deck_archetype,
      COUNT(*)::int AS count,
      ROUND(COUNT(*)::numeric / NULLIF(t.players, 0) * 100, 2)::float AS percentage_of_field,
      t.players AS player_count
    FROM player_stats ps
    JOIN tournaments t ON t.tid = ps.tid
    WHERE ps.deck_archetype IS NOT NULL
    GROUP BY ps.tid, ps.deck_archetype, t.start_date, t.players
`);

console.log("✅ Meta snapshots refreshed.");
await sql.end();
