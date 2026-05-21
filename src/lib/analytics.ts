import postgres from "postgres";

// --- Connection (reuses same pattern as db.ts) ---

let sql: ReturnType<typeof postgres>;

function getDb() {
  if (!sql) {
    const connectionString = import.meta.env.DATABASE_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    sql = postgres(connectionString, {
      prepare: false,
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sql;
}

// --- Types ---

export interface MetaBreakdownEntry {
  deck_archetype: string;
  total_count: number;
  avg_percentage: number;
}

export interface PlayerLeaderboardEntry {
  player_name: string;
  tournaments_played: number;
  total_wins: number;
  total_losses: number;
  total_draws: number;
  total_games: number;
  points: number;
  win_rate: number;
  points_per_game: number;
}

export interface FormatHealthEntry {
  tournament_date: string;
  tournament_name: string;
  player_count: number;
  unique_archetypes: number;
}

export interface MetaTrendEntry {
  deck_archetype: string;
  snapshot_date: string;
  percentage_of_field: number;
}

export interface Best8LeaderboardEntry {
  player_name: string;
  best8_points: number;
  best8_wins: number;
  best8_losses: number;
  best8_draws: number;
  tournaments_counted: number;
  tournaments_played: number;
}

// --- Analytics Queries ---

/**
 * Get meta breakdown — aggregated deck archetypes for a time period.
 * Default: last 90 days.
 */
export async function getMetaBreakdown(days: number = 90): Promise<MetaBreakdownEntry[]> {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const rows = await db<MetaBreakdownEntry[]>`
    SELECT
      ms.deck_archetype,
      SUM(ms.count)::int AS total_count,
      ROUND(AVG(ms.percentage_of_field)::numeric, 2)::float AS avg_percentage
    FROM meta_snapshots ms
    JOIN tournaments t ON ms.tid = t.tid
    WHERE t.start_date >= ${cutoff}
    GROUP BY ms.deck_archetype
    ORDER BY total_count DESC
  `;
  return rows;
}

/**
 * Get meta breakdown for a single tournament.
 */
export async function getMetaBreakdownByTournament(tid: string): Promise<MetaBreakdownEntry[]> {
  const db = getDb();

  const rows = await db<MetaBreakdownEntry[]>`
    SELECT
      deck_archetype,
      count AS total_count,
      percentage_of_field AS avg_percentage
    FROM meta_snapshots
    WHERE tid = ${tid}
    ORDER BY count DESC
  `;
  return rows;
}

/**
 * Get player leaderboard — ranked by win rate.
 * Minimum games threshold to filter out one-timers.
 */
export async function getPlayerLeaderboard(
  days: number = 90,
  minGames: number = 3
): Promise<PlayerLeaderboardEntry[]> {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const rows = await db<PlayerLeaderboardEntry[]>`
    SELECT
      ps.player_name,
      COUNT(DISTINCT ps.tid)::int AS tournaments_played,
      SUM(ps.wins_swiss)::int AS total_wins,
      SUM(ps.losses_swiss)::int AS total_losses,
      SUM(ps.draws)::int AS total_draws,
      (SUM(ps.wins_swiss) + SUM(ps.losses_swiss) + SUM(ps.draws))::int AS total_games,
      (SUM(ps.wins_swiss) * 3 + SUM(ps.draws))::int AS points,
      ROUND(
        SUM(ps.wins_swiss)::numeric /
        NULLIF(SUM(ps.wins_swiss) + SUM(ps.losses_swiss) + SUM(ps.draws), 0) * 100,
        2
      )::float AS win_rate,
      ROUND(
        (SUM(ps.wins_swiss) * 3 + SUM(ps.draws))::numeric /
        NULLIF(SUM(ps.wins_swiss) + SUM(ps.losses_swiss) + SUM(ps.draws), 0),
        2
      )::float AS points_per_game
    FROM player_stats ps
    JOIN tournaments t ON ps.tid = t.tid
    WHERE t.start_date >= ${cutoff}
    GROUP BY ps.player_name
    HAVING SUM(ps.wins_swiss) + SUM(ps.losses_swiss) + SUM(ps.draws) >= ${minGames}
    ORDER BY points DESC, win_rate DESC
  `;
  return rows;
}

/**
 * Get format health metrics — player counts and archetype diversity over time.
 */
export async function getFormatHealth(days: number = 90): Promise<FormatHealthEntry[]> {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const rows = await db<FormatHealthEntry[]>`
    SELECT
      TO_CHAR(TO_TIMESTAMP(t.start_date), 'YYYY-MM-DD') AS tournament_date,
      t.tournament_name,
      t.players AS player_count,
      COUNT(DISTINCT ms.deck_archetype)::int AS unique_archetypes
    FROM tournaments t
    LEFT JOIN meta_snapshots ms ON t.tid = ms.tid
    WHERE t.start_date >= ${cutoff}
    GROUP BY t.tid, t.tournament_name, t.players, t.start_date
    ORDER BY t.start_date ASC
  `;
  return rows;
}

/**
 * Get meta trends — how each archetype evolved over a date range.
 */
export async function getMetaTrends(days: number = 90): Promise<MetaTrendEntry[]> {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const rows = await db<MetaTrendEntry[]>`
    SELECT
      ms.deck_archetype,
      TO_CHAR(TO_TIMESTAMP(t.start_date), 'YYYY-MM-DD') AS snapshot_date,
      ms.percentage_of_field
    FROM meta_snapshots ms
    JOIN tournaments t ON ms.tid = t.tid
    WHERE t.start_date >= ${cutoff}
    ORDER BY t.start_date ASC, ms.deck_archetype
  `;
  return rows;
}

/**
 * Get meta breakdown filtered to tournaments whose name contains keyword.
 */
export async function getMetaBreakdownBySeason(keyword: string): Promise<MetaBreakdownEntry[]> {
  const db = getDb();
  const pattern = `%${keyword}%`;

  const rows = await db<MetaBreakdownEntry[]>`
    SELECT
      ms.deck_archetype,
      SUM(ms.count)::int AS total_count,
      ROUND(AVG(ms.percentage_of_field)::numeric, 2)::float AS avg_percentage
    FROM meta_snapshots ms
    JOIN tournaments t ON ms.tid = t.tid
    WHERE t.tournament_name ILIKE ${pattern}
    GROUP BY ms.deck_archetype
    ORDER BY total_count DESC
  `;
  return rows;
}

/**
 * Get player leaderboard filtered to tournaments whose name contains keyword.
 * No minimum games threshold — all participants are included.
 */
export async function getPlayerLeaderboardBySeason(keyword: string): Promise<PlayerLeaderboardEntry[]> {
  const db = getDb();
  const pattern = `%${keyword}%`;

  const rows = await db<PlayerLeaderboardEntry[]>`
    SELECT
      ps.player_name,
      COUNT(DISTINCT ps.tid)::int AS tournaments_played,
      SUM(ps.wins_swiss)::int AS total_wins,
      SUM(ps.losses_swiss)::int AS total_losses,
      SUM(ps.draws)::int AS total_draws,
      (SUM(ps.wins_swiss) + SUM(ps.losses_swiss) + SUM(ps.draws))::int AS total_games,
      (SUM(ps.wins_swiss) * 3 + SUM(ps.draws))::int AS points,
      ROUND(
        SUM(ps.wins_swiss)::numeric /
        NULLIF(SUM(ps.wins_swiss) + SUM(ps.losses_swiss) + SUM(ps.draws), 0) * 100,
        2
      )::float AS win_rate,
      ROUND(
        (SUM(ps.wins_swiss) * 3 + SUM(ps.draws))::numeric /
        NULLIF(SUM(ps.wins_swiss) + SUM(ps.losses_swiss) + SUM(ps.draws), 0),
        2
      )::float AS points_per_game
    FROM player_stats ps
    JOIN tournaments t ON ps.tid = t.tid
    WHERE t.tournament_name ILIKE ${pattern}
    GROUP BY ps.player_name
    ORDER BY points DESC, win_rate DESC
  `;
  return rows;
}

/**
 * Get format health metrics filtered to tournaments whose name contains keyword.
 */
export async function getFormatHealthBySeason(keyword: string): Promise<FormatHealthEntry[]> {
  const db = getDb();
  const pattern = `%${keyword}%`;

  const rows = await db<FormatHealthEntry[]>`
    SELECT
      TO_CHAR(TO_TIMESTAMP(t.start_date), 'YYYY-MM-DD') AS tournament_date,
      t.tournament_name,
      t.players AS player_count,
      COUNT(DISTINCT ms.deck_archetype)::int AS unique_archetypes
    FROM tournaments t
    LEFT JOIN meta_snapshots ms ON t.tid = ms.tid
    WHERE t.tournament_name ILIKE ${pattern}
    GROUP BY t.tid, t.tournament_name, t.players, t.start_date
    ORDER BY t.start_date ASC
  `;
  return rows;
}

/**
 * Quick summary stats filtered to tournaments whose name contains keyword.
 */
export async function getOverviewStatsBySeason(keyword: string) {
  const db = getDb();
  const pattern = `%${keyword}%`;

  const [stats] = await db`
    SELECT
      COUNT(DISTINCT t.tid)::int AS total_tournaments,
      COALESCE(SUM(t.players), 0)::int AS total_entries,
      ROUND(AVG(t.players)::numeric, 1)::float AS avg_field_size,
      COUNT(DISTINCT ps.player_name)::int AS unique_players
    FROM tournaments t
    LEFT JOIN player_stats ps ON t.tid = ps.tid
    WHERE t.tournament_name ILIKE ${pattern}
  `;

  return {
    totalTournaments: stats.total_tournaments ?? 0,
    totalEntries: stats.total_entries ?? 0,
    avgFieldSize: stats.avg_field_size ?? 0,
    uniquePlayers: stats.unique_players ?? 0,
  };
}

/**
 * Get top 8 players ranked by their best 8 tournament point scores in a season.
 * Each player's score = sum of their top-N tournament points (wins*3 + draws),
 * where N = min(8, tournaments_played). Tie-break: best8_wins DESC.
 */
export async function getBest8LeaderboardBySeason(keyword: string): Promise<Best8LeaderboardEntry[]> {
  const db = getDb();
  const pattern = `%${keyword}%`;

  const rows = await db<Best8LeaderboardEntry[]>`
    WITH tournament_points AS (
      SELECT
        ps.player_name,
        ps.tid,
        (ps.wins_swiss * 3 + ps.draws) AS tournament_points,
        ps.wins_swiss AS wins,
        ps.losses_swiss AS losses,
        ps.draws
      FROM player_stats ps
      JOIN tournaments t ON ps.tid = t.tid
      WHERE t.tournament_name ILIKE ${pattern}
    ),
    ranked AS (
      SELECT
        player_name,
        tournament_points,
        wins,
        losses,
        draws,
        ROW_NUMBER() OVER (PARTITION BY player_name ORDER BY tournament_points DESC) AS rn
      FROM tournament_points
    ),
    best8 AS (
      SELECT
        player_name,
        SUM(tournament_points)::int AS best8_points,
        SUM(wins)::int AS best8_wins,
        SUM(losses)::int AS best8_losses,
        SUM(draws)::int AS best8_draws,
        COUNT(*)::int AS tournaments_counted
      FROM ranked
      WHERE rn <= 8
      GROUP BY player_name
    ),
    total_played AS (
      SELECT
        ps.player_name,
        COUNT(DISTINCT ps.tid)::int AS tournaments_played
      FROM player_stats ps
      JOIN tournaments t ON ps.tid = t.tid
      WHERE t.tournament_name ILIKE ${pattern}
      GROUP BY ps.player_name
    )
    SELECT
      b.player_name,
      b.best8_points,
      b.best8_wins,
      b.best8_losses,
      b.best8_draws,
      b.tournaments_counted,
      tp.tournaments_played
    FROM best8 b
    JOIN total_played tp ON b.player_name = tp.player_name
    ORDER BY b.best8_points DESC, b.best8_wins DESC
    LIMIT 8
  `;
  return rows;
}

/**
 * Quick summary stats for the analytics dashboard.
 */
export async function getOverviewStats(days: number = 90) {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const [stats] = await db`
    SELECT
      COUNT(DISTINCT t.tid)::int AS total_tournaments,
      COALESCE(SUM(t.players), 0)::int AS total_entries,
      ROUND(AVG(t.players)::numeric, 1)::float AS avg_field_size,
      COUNT(DISTINCT ps.player_name)::int AS unique_players
    FROM tournaments t
    LEFT JOIN player_stats ps ON t.tid = ps.tid
    WHERE t.start_date >= ${cutoff}
  `;

  return {
    totalTournaments: stats.total_tournaments ?? 0,
    totalEntries: stats.total_entries ?? 0,
    avgFieldSize: stats.avg_field_size ?? 0,
    uniquePlayers: stats.unique_players ?? 0,
  };
}
