/**
 * fetch-tournament-data.mjs
 *
 * Fetches tournament data from the Melee.gg API, resolves deck archetypes
 * from standings decklists, and stores everything in the Supabase
 * PostgreSQL database.
 *
 * Endpoints used:
 *   1. GET /api/tournament/list              — paginated tournament list
 *   2. GET /api/standing/list/current/{id}   — final standings (W-L-D + decklist names)
 *
 * Auth: Basic authentication (MELEE_API_CLIENT_ID:MELEE_API_CLIENT_SECRET)
 *
 * Run manually:   node scripts/fetch-tournament-data.mjs
 * Run by CI:      GitHub Actions (daily at 06:00 UTC)
 */

import postgres from "postgres";
import { resolveArchetypeFromDecklist, normalizeArchetype } from "./lib/archetype-classifier.mjs";

// --- Config ---

const DATABASE_URL = process.env.DATABASE_URL;
const MELEE_CLIENT_ID = process.env.MELEE_API_CLIENT_ID;
const MELEE_CLIENT_SECRET = process.env.MELEE_API_CLIENT_SECRET;
const NUM_DAYS = 360; // Fetch 360 days to keep a good history window

if (!DATABASE_URL) {
    console.error("❌ DATABASE_URL is not set");
    process.exit(1);
}

if (!MELEE_CLIENT_ID || !MELEE_CLIENT_SECRET) {
    console.error("❌ MELEE_API_CLIENT_ID and MELEE_API_CLIENT_SECRET must be set");
    process.exit(1);
}

const AUTH_HEADER = "Basic " + Buffer.from(`${MELEE_CLIENT_ID}:${MELEE_CLIENT_SECRET}`).toString("base64");

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
    CREATE TABLE IF NOT EXISTS deck_archetypes (
      name TEXT PRIMARY KEY,
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
            omw_pct REAL,
            tgw_pct REAL,
            ogw_pct REAL,
      decklist TEXT,
      deck_archetype TEXT REFERENCES deck_archetypes(name) ON UPDATE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tid, player_name)
    )
  `;

    await sql`
    CREATE TABLE IF NOT EXISTS meta_snapshots (
      id SERIAL PRIMARY KEY,
      snapshot_date DATE NOT NULL,
      tid TEXT NOT NULL REFERENCES tournaments(tid) ON DELETE CASCADE,
      deck_archetype TEXT NOT NULL REFERENCES deck_archetypes(name) ON UPDATE CASCADE,
      count INTEGER NOT NULL DEFAULT 0,
      percentage_of_field REAL NOT NULL DEFAULT 0,
      player_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tid, deck_archetype)
    )
  `;

    await sql`
    CREATE TABLE IF NOT EXISTS player_rankings (
      player_name TEXT PRIMARY KEY,
      tournaments_played INTEGER NOT NULL DEFAULT 0,
      total_wins INTEGER NOT NULL DEFAULT 0,
      total_losses INTEGER NOT NULL DEFAULT 0,
      total_draws INTEGER NOT NULL DEFAULT 0,
      total_games INTEGER NOT NULL DEFAULT 0,
      points INTEGER NOT NULL DEFAULT 0,
      win_rate REAL NOT NULL DEFAULT 0,
      points_per_game REAL NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

    await sql`CREATE INDEX IF NOT EXISTS idx_tournaments_start_date ON tournaments(start_date DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_player_stats_tid ON player_stats(tid)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_meta_snapshots_date ON meta_snapshots(snapshot_date DESC)`;

    // --- Migration for existing databases: populate deck_archetypes from existing data ---
    await sql`
      INSERT INTO deck_archetypes (name)
      SELECT DISTINCT deck_archetype FROM player_stats
      WHERE deck_archetype IS NOT NULL
      ON CONFLICT (name) DO NOTHING
    `;
    await sql`
      INSERT INTO deck_archetypes (name)
      SELECT DISTINCT deck_archetype FROM meta_snapshots
      ON CONFLICT (name) DO NOTHING
    `;

    // Add FK constraints if they don't already exist (for pre-existing tables)
    try {
        await sql.unsafe(
            `ALTER TABLE player_stats ADD CONSTRAINT fk_player_stats_deck_archetype FOREIGN KEY (deck_archetype) REFERENCES deck_archetypes(name) ON UPDATE CASCADE`
        );
    } catch {
        // Constraint already exists; ignore
    }
    try {
        await sql.unsafe(
            `ALTER TABLE meta_snapshots ADD CONSTRAINT fk_meta_snapshots_deck_archetype FOREIGN KEY (deck_archetype) REFERENCES deck_archetypes(name) ON UPDATE CASCADE`
        );
    } catch {
        // Constraint already exists; ignore
    }

    // Add new columns if they don't exist (safe for re-runs on existing DBs)
    const newCols = [
        ["player_stats", "deck_archetype", "TEXT"],
        ["player_stats", "omw_pct", "REAL"],
        ["player_stats", "tgw_pct", "REAL"],
        ["player_stats", "ogw_pct", "REAL"],
    ];

    for (const [table, col, type] of newCols) {
        try {
            await sql.unsafe(
                `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`
            );
        } catch {
            // Column might already exist; ignore
        }
    }

    console.log("✅ Tables ensured");
}

// --- API request helpers ---

const REQUEST_DELAY_MS = 300;

async function meleeGet(path, params = {}) {
    const url = new URL(`https://melee.gg${path}`);
    for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString(), {
        headers: { Authorization: AUTH_HEADER },
    });

    if (res.status === 429) {
        console.warn("  ⚠ Rate limited (429). Waiting 10s...");
        await new Promise((r) => setTimeout(r, 10000));
        return meleeGet(path, params); // Retry once
    }

    if (!res.ok) {
        throw new Error(`Melee API error: ${res.status} ${res.statusText} for ${path}`);
    }

    return res.json();
}

/**
 * Fetch all pages of a paginated Melee endpoint.
 * Returns the full array of Content items.
 */
async function fetchAllPages(path, params = {}, pageSize = 250) {
    const allItems = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const data = await meleeGet(path, {
            ...params,
            "variables.page": page,
            "variables.pageSize": pageSize,
        });

        if (data.Content && Array.isArray(data.Content)) {
            allItems.push(...data.Content);
        }

        hasMore = data.HasMore === true;
        page++;

        if (hasMore) {
            await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
        }
    }

    return allItems;
}

// --- Fetch tournament list from Melee.gg ---

async function fetchTournaments() {
    const startDateFrom = new Date(Date.now() - NUM_DAYS * 86400000).toISOString();

    console.log(`📡 Fetching tournaments from Melee.gg (last ${NUM_DAYS} days)...`);
    const tournaments = await fetchAllPages("/api/tournament/list", { startDateFrom });

    // Only include ended tournaments
    const ended = tournaments.filter((t) => t.Status === 4);
    console.log(`📦 Fetched ${tournaments.length} tournaments (${ended.length} ended)`);
    return ended;
}

// --- Fetch standings for a tournament ---

async function fetchStandings(tournamentId) {
    try {
        const standings = await fetchAllPages(`/api/standing/list/current/${tournamentId}`);
        return standings;
    } catch (err) {
        console.warn(`  ⚠ Could not fetch standings for tournament ${tournamentId}: ${err.message}`);
        return null;
    }
}

// --- Fetch a single full decklist by its GUID ---

async function fetchDecklist(decklistId) {
    try {
        const data = await meleeGet(`/api/decklist/${decklistId}`);
        return data;
    } catch {
        return null;
    }
}

/**
 * Resolve "Unknown" archetypes for player stats that have a DecklistId.
 * Fetches full decklist from Melee.gg and uses name fields + card classifier.
 */
async function resolveUnknowns(playerStats) {
    const unknowns = playerStats.filter(
        (p) => p.deckArchetype === "Unknown" && p.decklistId
    );

    if (unknowns.length === 0) return;

    console.log(`    🔍 Resolving ${unknowns.length} Unknown archetypes...`);

    for (const player of unknowns) {
        const fullDecklist = await fetchDecklist(player.decklistId);
        if (!fullDecklist) continue;

        const result = resolveArchetypeFromDecklist(fullDecklist);
        if (result.archetype !== "Unknown") {
            player.deckArchetype = result.archetype;
        }

        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }

    const resolved = unknowns.filter((p) => p.deckArchetype !== "Unknown").length;
    if (resolved > 0) {
        console.log(`    ✓ Resolved ${resolved}/${unknowns.length} Unknown archetypes`);
    }
}



// --- Extract tournament metadata from Melee response ---

function parseTournament(tournament, standings) {
    const swissPhase = tournament.Phases?.find(
        (p) => p.Name?.toLowerCase().includes("swiss") || p.SortOrder === 1
    );
    const bracketPhase = tournament.Phases?.find(
        (p) => !p.Name?.toLowerCase().includes("swiss") && p.SortOrder > 1
    );

    const swissRounds = swissPhase?.Rounds?.length || 0;
    const topCut = bracketPhase?.Rounds?.length || 0;

    // Derive start_date from LastPairDateTime (same day as tournament)
    const startDate = tournament.LastPairDateTime
        ? Math.floor(new Date(tournament.LastPairDateTime).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

    return {
        tid: String(tournament.ID),
        tournamentName: tournament.Name,
        format: tournament.Formats?.[0] || "Pauper",
        bracketUrl: `https://melee.gg/Tournament/View/${tournament.ID}`,
        players: standings?.length || 0,
        startDate,
        swissRounds,
        topCut,
    };
}

// --- Parse standings into player stats ---

function parseStandings(standings) {
    if (!standings || !Array.isArray(standings)) return [];

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

    return standings.map((s) => {
        const playerName = s.Team?.Players?.[0]?.Name || s.Team?.Players?.[0]?.DisplayName || "Unknown";
        const decklistInfo = s.Decklists?.[0];
        const rawArchetype = decklistInfo?.DecklistName || "Unknown";
        const deckArchetype = normalizeArchetype(rawArchetype);
        const decklistId = decklistInfo?.DecklistId || null;
        const decklistUrl = decklistId
            ? `https://melee.gg/Decklist/View/${decklistId}`
            : null;

        return {
            playerName,
            winsSwiss: s.MatchWins || 0,
            lossesSwiss: s.MatchLosses || 0,
            draws: s.MatchDraws || 0,
            winsBracket: 0,
            lossesBracket: 0,
            omwPct: pickPct(s, [
                "OpponentMatchWinPercentage",
                "OMW",
                "OpponentsMatchWinPercentage",
            ]),
            tgwPct: pickPct(s, [
                "TeamGameWinPercentage",
                "PlayerGameWinPercentage",
                "TMW",
                "TGW",
            ]),
            ogwPct: pickPct(s, [
                "OpponentGameWinPercentage",
                "OpponentsGameWinPercentage",
                "OGW",
            ]),
            decklist: decklistUrl,
            decklistId,
            deckArchetype,
        };
    });
}

// --- Store data in database ---

async function storeTournament(tournamentData, playerStats) {
    // Upsert tournament
    await sql`
    INSERT INTO tournaments (tid, tournament_name, format, bracket_url, players, start_date, swiss_rounds, top_cut)
    VALUES (
      ${tournamentData.tid},
      ${tournamentData.tournamentName},
      ${tournamentData.format},
      ${tournamentData.bracketUrl},
      ${tournamentData.players},
      ${tournamentData.startDate},
      ${tournamentData.swissRounds},
      ${tournamentData.topCut}
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

    // Collect all unique archetypes and upsert into deck_archetypes first
    const uniqueArchetypes = new Set();
    for (const player of playerStats) {
        if (player.deckArchetype) uniqueArchetypes.add(player.deckArchetype);
    }
    for (const arch of uniqueArchetypes) {
        await sql`
          INSERT INTO deck_archetypes (name) VALUES (${arch})
          ON CONFLICT (name) DO NOTHING
        `;
    }

    // Upsert player stats
    const archCounts = {};

    for (const player of playerStats) {
        await sql`
      INSERT INTO player_stats (
        tid, player_name, wins_swiss, losses_swiss, draws,
                wins_bracket, losses_bracket, omw_pct, tgw_pct, ogw_pct, decklist, deck_archetype
      )
      VALUES (
        ${tournamentData.tid},
        ${player.playerName},
        ${player.winsSwiss},
        ${player.lossesSwiss},
        ${player.draws},
        ${player.winsBracket},
        ${player.lossesBracket},
                ${player.omwPct},
                ${player.tgwPct},
                ${player.ogwPct},
        ${player.decklist || null},
        ${player.deckArchetype}
      )
      ON CONFLICT (tid, player_name) DO UPDATE SET
        wins_swiss = EXCLUDED.wins_swiss,
        losses_swiss = EXCLUDED.losses_swiss,
        draws = EXCLUDED.draws,
        wins_bracket = EXCLUDED.wins_bracket,
        losses_bracket = EXCLUDED.losses_bracket,
                omw_pct = EXCLUDED.omw_pct,
                tgw_pct = EXCLUDED.tgw_pct,
                ogw_pct = EXCLUDED.ogw_pct,
        decklist = EXCLUDED.decklist,
        deck_archetype = EXCLUDED.deck_archetype
    `;

        // Count archetype occurrences for meta snapshot
        archCounts[player.deckArchetype] = (archCounts[player.deckArchetype] || 0) + 1;
    }

    // Upsert meta snapshots
    const totalPlayers = playerStats.length || tournamentData.players || 1;
    const snapshotDate = new Date(tournamentData.startDate * 1000).toISOString().split("T")[0];

    for (const [archetype, count] of Object.entries(archCounts)) {
        const percentage = ((count / totalPlayers) * 100).toFixed(2);

        await sql`
      INSERT INTO meta_snapshots (snapshot_date, tid, deck_archetype, count, percentage_of_field, player_count)
      VALUES (${snapshotDate}, ${tournamentData.tid}, ${archetype}, ${count}, ${percentage}, ${totalPlayers})
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
    const forceAll = process.argv.includes("--force");

    try {
        await ensureTables();
        const tournaments = await fetchTournaments();

        if (!tournaments || tournaments.length === 0) {
            console.log("No tournaments found.");
            return;
        }

        let tournamentsToFetch;

        if (forceAll) {
            console.log("⚡ --force flag: re-fetching ALL tournaments.");
            tournamentsToFetch = tournaments;
        } else {
            // --- Incremental fetch: skip already-imported old tournaments ---
            const oneWeekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;

            const existingTids = await sql`SELECT DISTINCT tid FROM player_stats`;
            const existingSet = new Set(existingTids.map((r) => r.tid));

            tournamentsToFetch = tournaments.filter((t) => {
                const tid = String(t.ID);
                const isNew = !existingSet.has(tid);
                const startDate = t.LastPairDateTime
                    ? Math.floor(new Date(t.LastPairDateTime).getTime() / 1000)
                    : 0;
                const isRecent = startDate >= oneWeekAgo;
                return isNew || isRecent;
            });

            console.log(
                `Found ${tournaments.length} total tournaments. ` +
                `Skipping ${tournaments.length - tournamentsToFetch.length} already-imported. ` +
                `Fetching ${tournamentsToFetch.length} new/recent tournaments.`
            );

            if (tournamentsToFetch.length === 0) {
                console.log("Nothing new to fetch. Done.");
                return;
            }
        }

        let stored = 0;
        for (const tournament of tournamentsToFetch) {
            try {
                const tournamentId = tournament.ID;

                // Fetch standings (includes embedded decklists with archetype names)
                console.log(`  📋 Fetching standings for ${tournament.Name} (${tournamentId})...`);
                const standings = await fetchStandings(tournamentId);

                if (!standings || standings.length === 0) {
                    console.log(`  ⚠ No standings found for ${tournamentId}, skipping.`);
                    continue;
                }

                // Parse tournament metadata
                const tournamentData = parseTournament(tournament, standings);

                // Parse player stats from standings
                const playerStats = parseStandings(standings);

                console.log(`    → ${playerStats.length} players, ${tournamentData.swissRounds} Swiss rounds`);

                // Resolve Unknown archetypes via full decklist fetch + classifier
                await resolveUnknowns(playerStats);

                await storeTournament(tournamentData, playerStats);
                stored++;
                console.log(
                    `  ✓ ${tournament.Name} (${tournamentId}) — ${playerStats.length} players`
                );

                // Small delay to be nice to the API
                await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
            } catch (err) {
                console.error(`  ✗ Failed to store ${tournament.ID}:`, err.message);
            }
        }

        console.log(`\n🎉 Done! Stored ${stored}/${tournamentsToFetch.length} tournaments (${tournaments.length - tournamentsToFetch.length} skipped).`);

        // Refresh the player_rankings table
        console.log("\n📊 Refreshing player rankings...");
        await refreshPlayerRankings();
        console.log("✅ Player rankings refreshed.");

        // Refresh meta snapshots from player_stats (picks up manual archetype corrections)
        console.log("\n📊 Refreshing meta snapshots...");
        await refreshMetaSnapshots();
        console.log("✅ Meta snapshots refreshed.");
    } catch (err) {
        console.error("❌ Fatal error:", err);
        process.exit(1);
    } finally {
        await sql.end();
    }
}

/**
 * Recompute the player_rankings table from player_stats.
 * 1 win = 3 pts, 1 draw = 1 pt, 1 loss = 0 pts.
 */
async function refreshPlayerRankings() {
  await sql`DELETE FROM player_rankings`;
  await sql`
    INSERT INTO player_rankings (
      player_name, tournaments_played,
      total_wins, total_losses, total_draws, total_games,
      points, win_rate, points_per_game, updated_at
    )
    SELECT
      ps.player_name,
      COUNT(DISTINCT ps.tid)::int AS tournaments_played,
      SUM(ps.wins_swiss)::int AS total_wins,
      SUM(ps.losses_swiss)::int AS total_losses,
      SUM(ps.draws)::int AS total_draws,
      (SUM(ps.wins_swiss) + SUM(ps.losses_swiss) + SUM(ps.draws))::int AS total_games,
      (SUM(ps.wins_swiss) * 3 + SUM(ps.draws))::int AS points,
      COALESCE(
        ROUND(
          SUM(ps.wins_swiss)::numeric /
          NULLIF(SUM(ps.wins_swiss) + SUM(ps.losses_swiss) + SUM(ps.draws), 0) * 100,
          2
        ),
        0
      )::float AS win_rate,
      COALESCE(
        ROUND(
          (SUM(ps.wins_swiss) * 3 + SUM(ps.draws))::numeric /
          NULLIF(SUM(ps.wins_swiss) + SUM(ps.losses_swiss) + SUM(ps.draws), 0),
          2
        ),
        0
      )::float AS points_per_game,
      NOW()
    FROM player_stats ps
    GROUP BY ps.player_name
  `;
}

/**
 * Recompute the meta_snapshots table from player_stats + tournaments.
 * This ensures manual archetype corrections in player_stats are reflected.
 */
async function refreshMetaSnapshots() {
    await sql`DELETE FROM meta_snapshots`;

    // Ensure all archetypes from player_stats exist in deck_archetypes
    await sql`
      INSERT INTO deck_archetypes (name)
      SELECT DISTINCT deck_archetype FROM player_stats
      WHERE deck_archetype IS NOT NULL
      ON CONFLICT (name) DO NOTHING
    `;

    await sql`
    INSERT INTO meta_snapshots (
      snapshot_date, tid, deck_archetype, count, percentage_of_field, player_count
    )
    SELECT
      TO_TIMESTAMP(t.start_date)::date AS snapshot_date,
      ps.tid,
      ps.deck_archetype,
      COUNT(*)::int AS count,
      ROUND(COUNT(*)::numeric / NULLIF(t.players, 0) * 100, 2)::float AS percentage_of_field,
      t.players AS player_count
    FROM player_stats ps
    JOIN tournaments t ON t.tid = ps.tid
    WHERE ps.deck_archetype IS NOT NULL
    GROUP BY ps.tid, ps.deck_archetype, t.start_date, t.players
  `;
}

main();
