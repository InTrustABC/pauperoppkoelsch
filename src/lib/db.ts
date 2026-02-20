import postgres from "postgres";

// --- Connection ---

let sql: ReturnType<typeof postgres>;

function getDb() {
    if (!sql) {
        const connectionString = import.meta.env.DATABASE_URL ?? process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL environment variable is not set");
        }
        sql = postgres(connectionString, {
            // Supabase transaction-mode pooling recommended for serverless
            prepare: false,
            // Connection pool settings for serverless
            max: 3,
            idle_timeout: 20,
            connect_timeout: 10,
        });
    }
    return sql;
}

// --- Types ---

export interface Tournament {
    tid: string;
    tournament_name: string;
    format: string;
    bracket_url: string;
    players: number;
    start_date: number; // Unix timestamp
    swiss_rounds: number;
    top_cut: number;
    created_at?: string;
}

export interface PlayerStat {
    id?: number;
    tid: string;
    player_name: string;
    wins_swiss: number;
    losses_swiss: number;
    draws: number;
    wins_bracket: number;
    losses_bracket: number;
    decklist: string | null;
    deck_name: string | null;
    created_at?: string;
}

export interface MetaSnapshot {
    id?: number;
    snapshot_date: string;
    tid: string;
    deck_archetype: string;
    count: number;
    percentage_of_field: number;
    player_count: number;
    created_at?: string;
}

// Combined type for display (matches the old API shape)
export interface TournamentWithStandings extends Tournament {
    standings: PlayerStanding[];
}

export interface PlayerStanding {
    name: string;
    decklist: string;
    winsSwiss: number;
    lossesSwiss: number;
    draws: number;
    winsBracket: number;
    lossesBracket: number;
}

// --- Schema Initialization ---

export async function initializeDatabase() {
    const db = getDb();

    await db`
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

    await db`
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

    await db`
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

    // Index for fast date-range queries
    await db`
    CREATE INDEX IF NOT EXISTS idx_tournaments_start_date ON tournaments(start_date DESC)
  `;

    await db`
    CREATE INDEX IF NOT EXISTS idx_player_stats_tid ON player_stats(tid)
  `;

    await db`
    CREATE INDEX IF NOT EXISTS idx_meta_snapshots_date ON meta_snapshots(snapshot_date DESC)
  `;
}

// --- Tournament Queries ---

export async function upsertTournament(t: Tournament) {
    const db = getDb();
    await db`
    INSERT INTO tournaments (tid, tournament_name, format, bracket_url, players, start_date, swiss_rounds, top_cut)
    VALUES (${t.tid}, ${t.tournament_name}, ${t.format}, ${t.bracket_url}, ${t.players}, ${t.start_date}, ${t.swiss_rounds}, ${t.top_cut})
    ON CONFLICT (tid) DO UPDATE SET
      tournament_name = EXCLUDED.tournament_name,
      format = EXCLUDED.format,
      bracket_url = EXCLUDED.bracket_url,
      players = EXCLUDED.players,
      start_date = EXCLUDED.start_date,
      swiss_rounds = EXCLUDED.swiss_rounds,
      top_cut = EXCLUDED.top_cut
  `;
}

export async function upsertPlayerStat(p: PlayerStat) {
    const db = getDb();
    await db`
    INSERT INTO player_stats (tid, player_name, wins_swiss, losses_swiss, draws, wins_bracket, losses_bracket, decklist, deck_name)
    VALUES (${p.tid}, ${p.player_name}, ${p.wins_swiss}, ${p.losses_swiss}, ${p.draws}, ${p.wins_bracket}, ${p.losses_bracket}, ${p.decklist}, ${p.deck_name})
    ON CONFLICT (tid, player_name) DO UPDATE SET
      wins_swiss = EXCLUDED.wins_swiss,
      losses_swiss = EXCLUDED.losses_swiss,
      draws = EXCLUDED.draws,
      wins_bracket = EXCLUDED.wins_bracket,
      losses_bracket = EXCLUDED.losses_bracket,
      decklist = EXCLUDED.decklist,
      deck_name = EXCLUDED.deck_name
  `;
}

export async function upsertMetaSnapshot(m: MetaSnapshot) {
    const db = getDb();
    await db`
    INSERT INTO meta_snapshots (snapshot_date, tid, deck_archetype, count, percentage_of_field, player_count)
    VALUES (${m.snapshot_date}, ${m.tid}, ${m.deck_archetype}, ${m.count}, ${m.percentage_of_field}, ${m.player_count})
    ON CONFLICT (tid, deck_archetype) DO UPDATE SET
      snapshot_date = EXCLUDED.snapshot_date,
      count = EXCLUDED.count,
      percentage_of_field = EXCLUDED.percentage_of_field,
      player_count = EXCLUDED.player_count
  `;
}

// --- Read Queries ---

export async function getAllTournaments(days: number = 90): Promise<Tournament[]> {
    const db = getDb();
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    const rows = await db<Tournament[]>`
    SELECT * FROM tournaments
    WHERE start_date >= ${cutoff}
    ORDER BY start_date DESC
  `;
    return rows;
}

export async function getTournamentById(tid: string): Promise<Tournament | null> {
    const db = getDb();
    const rows = await db<Tournament[]>`
    SELECT * FROM tournaments WHERE tid = ${tid} LIMIT 1
  `;
    return rows.length > 0 ? rows[0] : null;
}

export async function getPlayerStatsByTournament(tid: string): Promise<PlayerStat[]> {
    const db = getDb();
    const rows = await db<PlayerStat[]>`
    SELECT * FROM player_stats
    WHERE tid = ${tid}
    ORDER BY wins_swiss DESC, losses_swiss ASC, draws DESC
  `;
    return rows;
}

/**
 * Returns a tournament with standings in the shape the frontend expects.
 */
export async function getTournamentWithStandings(tid: string): Promise<TournamentWithStandings | null> {
    const tournament = await getTournamentById(tid);
    if (!tournament) return null;

    const playerStats = await getPlayerStatsByTournament(tid);

    const standings: PlayerStanding[] = playerStats.map((p) => ({
        name: p.player_name,
        decklist: p.decklist ?? "",
        winsSwiss: p.wins_swiss,
        lossesSwiss: p.losses_swiss,
        draws: p.draws,
        winsBracket: p.wins_bracket,
        lossesBracket: p.losses_bracket,
    }));

    return {
        ...tournament,
        standings,
    };
}

export async function getMetaSnapshotsByDateRange(
    startDate: string,
    endDate: string
): Promise<MetaSnapshot[]> {
    const db = getDb();
    const rows = await db<MetaSnapshot[]>`
    SELECT * FROM meta_snapshots
    WHERE snapshot_date >= ${startDate} AND snapshot_date <= ${endDate}
    ORDER BY snapshot_date DESC
  `;
    return rows;
}
