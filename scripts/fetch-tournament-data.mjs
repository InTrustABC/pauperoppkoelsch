/**
 * fetch-tournament-data.mjs
 *
 * Fetches tournament data from the SpiceRack API, parses deck archetypes,
 * and stores everything in the Supabase PostgreSQL database.
 *
 * Run manually:   node scripts/fetch-tournament-data.mjs
 * Run by CI:      GitHub Actions (daily at 06:00 UTC)
 */

import postgres from "postgres";

// --- Config ---

const DATABASE_URL = process.env.DATABASE_URL;
const SPICERACK_API_KEY = process.env.SPICERACK_API_KEY;
const API_BASE = "https://api.spicerack.gg";
const NUM_DAYS = 180; // Fetch 180 days to keep a good history window

if (!DATABASE_URL) {
    console.error("❌ DATABASE_URL is not set");
    process.exit(1);
}

const sql = postgres(DATABASE_URL, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
});

// --- Ensure tables exist ---

async function ensureTables() {
    await sql`
    CREATE TABLE IF NOT EXISTS tournaments (
      tid TEXT PRIMARY KEY,
      tournament_name TEXT NOT NULL,
      format TEXT NOT NULL,
      bracket_url TEXT DEFAULT '',
      players INTEGER NOT NULL DEFAULT 0,
      start_date INTEGER NOT NULL,
      swiss_rounds INTEGER NOT NULL DEFAULT 0,
      top_cut INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

    await sql`
    CREATE TABLE IF NOT EXISTS player_stats (
      id SERIAL PRIMARY KEY,
      tid TEXT NOT NULL REFERENCES tournaments(tid) ON DELETE CASCADE,
      player_name TEXT NOT NULL,
      wins_swiss INTEGER NOT NULL DEFAULT 0,
      losses_swiss INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      wins_bracket INTEGER NOT NULL DEFAULT 0,
      losses_bracket INTEGER NOT NULL DEFAULT 0,
      decklist TEXT,
      deck_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tid, player_name)
    )
  `;

    await sql`
    CREATE TABLE IF NOT EXISTS meta_snapshots (
      id SERIAL PRIMARY KEY,
      snapshot_date DATE NOT NULL,
      tid TEXT NOT NULL REFERENCES tournaments(tid) ON DELETE CASCADE,
      deck_archetype TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      percentage_of_field REAL NOT NULL DEFAULT 0,
      player_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tid, deck_archetype)
    )
  `;

    await sql`CREATE INDEX IF NOT EXISTS idx_tournaments_start_date ON tournaments(start_date DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_player_stats_tid ON player_stats(tid)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_meta_snapshots_date ON meta_snapshots(snapshot_date DESC)`;

    console.log("✅ Tables ensured");
}

// --- Fetch from SpiceRack ---

async function fetchTournaments() {
    const url = `${API_BASE}/api/export-decklists/?num_days=${NUM_DAYS}&event_format=Pauper&organization_id=8703`;
    const headers = { "Content-Type": "application/json" };

    // Only add API key header if available
    if (SPICERACK_API_KEY) {
        headers["Authorization"] = `Bearer ${SPICERACK_API_KEY}`;
    }

    console.log(`📡 Fetching tournaments from SpiceRack (last ${NUM_DAYS} days)...`);
    const response = await fetch(url, { method: "GET", headers });

    if (!response.ok) {
        throw new Error(`SpiceRack API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`📦 Fetched ${data.length} tournaments`);
    return data;
}

// --- Parse deck archetype from decklist URL or text ---

/**
 * Simple archetype extraction heuristic.
 * In practice you might want to improve this with more patterns
 * or use the SpiceRack deck classification if available.
 */
function extractDeckArchetype(player) {
    // If deck_name is provided by API, use it directly
    if (player.deck_name) return player.deck_name;

    // Try to extract from decklist URL (e.g., moxfield URLs sometimes have deck name)
    if (player.decklist) {
        const url = player.decklist.toLowerCase();
        // Common patterns in Moxfield/Goldfish URLs
        if (url.includes("moxfield.com")) {
            // URL path often contains deck slug
            const parts = url.split("/");
            const slug = parts[parts.length - 1];
            if (slug && slug.length > 3) {
                return slug.replace(/-/g, " ").replace(/_/g, " ");
            }
        }
    }

    return "Unknown";
}

// --- Store data in database ---

async function storeTournament(tournament) {
    // Upsert tournament
    await sql`
    INSERT INTO tournaments (tid, tournament_name, format, bracket_url, players, start_date, swiss_rounds, top_cut)
    VALUES (
      ${tournament.TID},
      ${tournament.tournamentName},
      ${tournament.format},
      ${tournament.bracketUrl || ""},
      ${tournament.players},
      ${tournament.startDate},
      ${tournament.swissRounds},
      ${tournament.topCut}
    )
    ON CONFLICT (tid) DO UPDATE SET
      tournament_name = EXCLUDED.tournament_name,
      format = EXCLUDED.format,
      bracket_url = EXCLUDED.bracket_url,
      players = EXCLUDED.players,
      start_date = EXCLUDED.start_date,
      swiss_rounds = EXCLUDED.swiss_rounds,
      top_cut = EXCLUDED.top_cut
  `;

    // Upsert player stats
    const archCounts = {};

    for (const player of tournament.standings || []) {
        const deckName = extractDeckArchetype(player);

        await sql`
      INSERT INTO player_stats (tid, player_name, wins_swiss, losses_swiss, draws, wins_bracket, losses_bracket, decklist, deck_name)
      VALUES (
        ${tournament.TID},
        ${player.name},
        ${player.winsSwiss},
        ${player.lossesSwiss},
        ${player.draws},
        ${player.winsBracket || 0},
        ${player.lossesBracket || 0},
        ${player.decklist || null},
        ${deckName}
      )
      ON CONFLICT (tid, player_name) DO UPDATE SET
        wins_swiss = EXCLUDED.wins_swiss,
        losses_swiss = EXCLUDED.losses_swiss,
        draws = EXCLUDED.draws,
        wins_bracket = EXCLUDED.wins_bracket,
        losses_bracket = EXCLUDED.losses_bracket,
        decklist = EXCLUDED.decklist,
        deck_name = EXCLUDED.deck_name
    `;

        // Count archetype occurrences
        archCounts[deckName] = (archCounts[deckName] || 0) + 1;
    }

    // Upsert meta snapshots
    const totalPlayers = tournament.standings?.length || tournament.players || 1;
    const snapshotDate = new Date(tournament.startDate * 1000).toISOString().split("T")[0];

    for (const [archetype, count] of Object.entries(archCounts)) {
        const percentage = ((count / totalPlayers) * 100).toFixed(2);

        await sql`
      INSERT INTO meta_snapshots (snapshot_date, tid, deck_archetype, count, percentage_of_field, player_count)
      VALUES (${snapshotDate}, ${tournament.TID}, ${archetype}, ${count}, ${percentage}, ${totalPlayers})
      ON CONFLICT (tid, deck_archetype) DO UPDATE SET
        snapshot_date = EXCLUDED.snapshot_date,
        count = EXCLUDED.count,
        percentage_of_field = EXCLUDED.percentage_of_field,
        player_count = EXCLUDED.player_count
    `;
    }
}

// --- Main ---

async function main() {
    try {
        await ensureTables();
        const tournaments = await fetchTournaments();

        let stored = 0;
        for (const tournament of tournaments) {
            try {
                await storeTournament(tournament);
                stored++;
                console.log(`  ✓ ${tournament.tournamentName} (${tournament.TID}) — ${tournament.standings?.length || 0} players`);
            } catch (err) {
                console.error(`  ✗ Failed to store ${tournament.TID}:`, err.message);
            }
        }

        console.log(`\n🎉 Done! Stored ${stored}/${tournaments.length} tournaments.`);
    } catch (err) {
        console.error("❌ Fatal error:", err);
        process.exit(1);
    } finally {
        await sql.end();
    }
}

main();
