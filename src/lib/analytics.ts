import postgres from "postgres";
import { consolidatePlayerLeaderboard, computeBest8Leaderboard, getAliasesForCanonicalName } from "./player-aliases";

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
  avg_omw_pct: number | null;
  avg_tgw_pct: number | null;
  avg_ogw_pct: number | null;
  tournaments_counted: number;
  tournaments_played: number;
}

export interface PlayerDeckStatEntry {
  deck_archetype: string;
  wins: number;
  losses: number;
  draws: number;
  tournaments: number;
  win_rate: number;
}

export interface DateRangeFilter {
  startDateUnix?: number;
  endDateUnixExclusive?: number;
}

export interface ResolvedDateRange {
  from: string;
  to: string;
  startDateUnix: number;
  endDateUnixExclusive: number;
}

const DAY_IN_SECONDS = 86400;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GERMAN_DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/;

function toIsoDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDateParts(date: string): { year: number; month: number; day: number } | null {
  if (!ISO_DATE_RE.test(date)) {
    return null;
  }

  const [yearRaw, monthRaw, dayRaw] = date.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const test = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(test.getTime()) ||
    test.getUTCFullYear() !== year ||
    test.getUTCMonth() + 1 !== month ||
    test.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function parseGermanDateParts(date: string): { year: number; month: number; day: number } | null {
  if (!GERMAN_DATE_RE.test(date)) {
    return null;
  }

  const [dayRaw, monthRaw, yearRaw] = date.split(".");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const test = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(test.getTime()) ||
    test.getUTCFullYear() !== year ||
    test.getUTCMonth() + 1 !== month ||
    test.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function parseDateParts(date: string): { year: number; month: number; day: number } | null {
  return parseIsoDateParts(date) ?? parseGermanDateParts(date);
}

function formatPartsToIsoDate(parts: { year: number; month: number; day: number }): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function normalizeDateInput(date: string): string | null {
  const parts = parseDateParts(date);
  if (!parts) {
    return null;
  }
  return formatPartsToIsoDate(parts);
}

export function isoDateToUnixStart(date: string): number | null {
  const parts = parseDateParts(date);
  if (!parts) {
    return null;
  }

  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0) / 1000);
}

export function isoDateToUnixEndExclusive(date: string): number | null {
  const parts = parseDateParts(date);
  if (!parts) {
    return null;
  }

  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 0, 0, 0) / 1000);
}

export function unixToIsoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function getTodayIsoDate(): string {
  return toIsoDateLocal(new Date());
}

export function formatDateForDisplay(date: string): string {
  const normalized = normalizeDateInput(date);
  if (!normalized) {
    return date;
  }

  const [year, month, day] = normalized.split("-");
  return `${day}.${month}.${year}`;
}

export function resolveDateRange(params: {
  fromParam?: string | null;
  toParam?: string | null;
  defaultFrom: string;
  defaultTo?: string;
}): ResolvedDateRange {
  const defaultTo = params.defaultTo ?? getTodayIsoDate();

  const fromCandidate = params.fromParam ?? params.defaultFrom;
  const toCandidate = params.toParam ?? defaultTo;

  const normalizedDefaultFrom = normalizeDateInput(params.defaultFrom) ?? getTodayIsoDate();
  const normalizedDefaultTo = normalizeDateInput(defaultTo) ?? getTodayIsoDate();
  const normalizedFrom = normalizeDateInput(fromCandidate) ?? normalizedDefaultFrom;
  const normalizedTo = normalizeDateInput(toCandidate) ?? normalizedDefaultTo;

  let startDateUnix = isoDateToUnixStart(normalizedFrom)!;
  const endDateUnixExclusive = isoDateToUnixEndExclusive(normalizedTo)!;
  let from = normalizedFrom;

  if (startDateUnix >= endDateUnixExclusive) {
    from = normalizedTo;
    startDateUnix = isoDateToUnixStart(from)!;
  }

  return {
    from,
    to: normalizedTo,
    startDateUnix,
    endDateUnixExclusive,
  };
}

export async function getEarliestTournamentDate(): Promise<string | null> {
  const db = getDb();
  const [row] = await db<{ min_start_date: number | null }[]>`
    SELECT MIN(start_date)::int AS min_start_date
    FROM tournaments
  `;

  if (!row?.min_start_date) {
    return null;
  }

  return unixToIsoDate(row.min_start_date);
}

export async function getEarliestTournamentDateBySeason(keyword: string): Promise<string | null> {
  const db = getDb();
  const pattern = `%${keyword}%`;
  const [row] = await db<{ min_start_date: number | null }[]>`
    SELECT MIN(start_date)::int AS min_start_date
    FROM tournaments
    WHERE tournament_name ILIKE ${pattern}
  `;

  if (!row?.min_start_date) {
    return null;
  }

  return unixToIsoDate(row.min_start_date);
}

// --- Analytics Queries ---

/**
 * Get meta breakdown — aggregated deck archetypes for a time period.
 * Default: last 90 days.
 */
export async function getMetaBreakdown(
  days: number = 90,
  range?: DateRangeFilter,
): Promise<MetaBreakdownEntry[]> {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - days * DAY_IN_SECONDS;
  const startDateUnix = range?.startDateUnix ?? cutoff;
  const endFilter = range?.endDateUnixExclusive !== undefined
    ? db`AND t.start_date < ${range.endDateUnixExclusive}`
    : db``;

  const rows = await db<MetaBreakdownEntry[]>`
    SELECT
      ms.deck_archetype,
      SUM(ms.count)::int AS total_count,
      ROUND(AVG(ms.percentage_of_field)::numeric, 2)::float AS avg_percentage
    FROM meta_snapshots ms
    JOIN tournaments t ON ms.tid = t.tid
    WHERE t.start_date >= ${startDateUnix}
    ${endFilter}
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
  minGames: number = 3,
  range?: DateRangeFilter,
): Promise<PlayerLeaderboardEntry[]> {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - days * DAY_IN_SECONDS;
  const startDateUnix = range?.startDateUnix ?? cutoff;
  const endFilter = range?.endDateUnixExclusive !== undefined
    ? db`AND t.start_date < ${range.endDateUnixExclusive}`
    : db``;

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
    WHERE t.start_date >= ${startDateUnix}
    ${endFilter}
    GROUP BY ps.player_name
    HAVING SUM(ps.wins_swiss) + SUM(ps.losses_swiss) + SUM(ps.draws) >= ${minGames}
    ORDER BY points DESC, win_rate DESC
  `;
  return consolidatePlayerLeaderboard(rows);
}

/**
 * Get format health metrics — player counts and archetype diversity over time.
 */
export async function getFormatHealth(
  days: number = 90,
  range?: DateRangeFilter,
): Promise<FormatHealthEntry[]> {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - days * DAY_IN_SECONDS;
  const startDateUnix = range?.startDateUnix ?? cutoff;
  const endFilter = range?.endDateUnixExclusive !== undefined
    ? db`AND t.start_date < ${range.endDateUnixExclusive}`
    : db``;

  const rows = await db<FormatHealthEntry[]>`
    SELECT
      TO_CHAR(TO_TIMESTAMP(t.start_date), 'YYYY-MM-DD') AS tournament_date,
      t.tournament_name,
      t.players AS player_count,
      COUNT(DISTINCT ms.deck_archetype)::int AS unique_archetypes
    FROM tournaments t
    LEFT JOIN meta_snapshots ms ON t.tid = ms.tid
    WHERE t.start_date >= ${startDateUnix}
    ${endFilter}
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
export async function getMetaBreakdownBySeason(
  keyword: string,
  range?: DateRangeFilter,
): Promise<MetaBreakdownEntry[]> {
  const db = getDb();
  const pattern = `%${keyword}%`;
  const startFilter = range?.startDateUnix !== undefined
    ? db`AND t.start_date >= ${range.startDateUnix}`
    : db``;
  const endFilter = range?.endDateUnixExclusive !== undefined
    ? db`AND t.start_date < ${range.endDateUnixExclusive}`
    : db``;

  const rows = await db<MetaBreakdownEntry[]>`
    SELECT
      ms.deck_archetype,
      SUM(ms.count)::int AS total_count,
      ROUND(AVG(ms.percentage_of_field)::numeric, 2)::float AS avg_percentage
    FROM meta_snapshots ms
    JOIN tournaments t ON ms.tid = t.tid
    WHERE t.tournament_name ILIKE ${pattern}
    ${startFilter}
    ${endFilter}
    GROUP BY ms.deck_archetype
    ORDER BY total_count DESC
  `;
  return rows;
}

/**
 * Get player leaderboard filtered to tournaments whose name contains keyword.
 * No minimum games threshold — all participants are included.
 */
export async function getPlayerLeaderboardBySeason(
  keyword: string,
  range?: DateRangeFilter,
): Promise<PlayerLeaderboardEntry[]> {
  const db = getDb();
  const pattern = `%${keyword}%`;
  const startFilter = range?.startDateUnix !== undefined
    ? db`AND t.start_date >= ${range.startDateUnix}`
    : db``;
  const endFilter = range?.endDateUnixExclusive !== undefined
    ? db`AND t.start_date < ${range.endDateUnixExclusive}`
    : db``;

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
    ${startFilter}
    ${endFilter}
    GROUP BY ps.player_name
    ORDER BY points DESC, win_rate DESC
  `;
  return consolidatePlayerLeaderboard(rows);
}

/**
 * Get format health metrics filtered to tournaments whose name contains keyword.
 */
export async function getFormatHealthBySeason(
  keyword: string,
  range?: DateRangeFilter,
): Promise<FormatHealthEntry[]> {
  const db = getDb();
  const pattern = `%${keyword}%`;
  const startFilter = range?.startDateUnix !== undefined
    ? db`AND t.start_date >= ${range.startDateUnix}`
    : db``;
  const endFilter = range?.endDateUnixExclusive !== undefined
    ? db`AND t.start_date < ${range.endDateUnixExclusive}`
    : db``;

  const rows = await db<FormatHealthEntry[]>`
    SELECT
      TO_CHAR(TO_TIMESTAMP(t.start_date), 'YYYY-MM-DD') AS tournament_date,
      t.tournament_name,
      t.players AS player_count,
      COUNT(DISTINCT ms.deck_archetype)::int AS unique_archetypes
    FROM tournaments t
    LEFT JOIN meta_snapshots ms ON t.tid = ms.tid
    WHERE t.tournament_name ILIKE ${pattern}
    ${startFilter}
    ${endFilter}
    GROUP BY t.tid, t.tournament_name, t.players, t.start_date
    ORDER BY t.start_date ASC
  `;
  return rows;
}

/**
 * Quick summary stats filtered to tournaments whose name contains keyword.
 */
export async function getOverviewStatsBySeason(keyword: string, range?: DateRangeFilter) {
  const db = getDb();
  const pattern = `%${keyword}%`;
  const startFilter = range?.startDateUnix !== undefined
    ? db`AND t.start_date >= ${range.startDateUnix}`
    : db``;
  const endFilter = range?.endDateUnixExclusive !== undefined
    ? db`AND t.start_date < ${range.endDateUnixExclusive}`
    : db``;

  const [stats] = await db`
    SELECT
      COUNT(DISTINCT t.tid)::int AS total_tournaments,
      COALESCE(SUM(t.players), 0)::int AS total_entries,
      ROUND(AVG(t.players)::numeric, 1)::float AS avg_field_size,
      COUNT(DISTINCT ps.player_name)::int AS unique_players
    FROM tournaments t
    LEFT JOIN player_stats ps ON t.tid = ps.tid
    WHERE t.tournament_name ILIKE ${pattern}
    ${startFilter}
    ${endFilter}
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
export interface TournamentScore {
  player_name: string;
  tid: string;
  tournament_points: number;
  wins: number;
  losses: number;
  draws: number;
  omw_pct: number | null;
  tgw_pct: number | null;
  ogw_pct: number | null;
}

interface TournamentDeckScore {
  tid: string;
  tournament_points: number;
  wins: number;
  losses: number;
  draws: number;
  deck_archetype: string | null;
}

export async function getBest8LeaderboardBySeason(
  keyword: string,
  range?: DateRangeFilter,
): Promise<Best8LeaderboardEntry[]> {
  const db = getDb();
  const pattern = `%${keyword}%`;
  const startFilter = range?.startDateUnix !== undefined
    ? db`AND t.start_date >= ${range.startDateUnix}`
    : db``;
  const endFilter = range?.endDateUnixExclusive !== undefined
    ? db`AND t.start_date < ${range.endDateUnixExclusive}`
    : db``;

  const rows = await db<TournamentScore[]>`
    SELECT
      ps.player_name,
      ps.tid,
      (ps.wins_swiss * 3 + ps.draws)::int AS tournament_points,
      ps.wins_swiss::int AS wins,
      ps.losses_swiss::int AS losses,
      ps.draws::int AS draws,
      ps.omw_pct::float AS omw_pct,
      ps.tgw_pct::float AS tgw_pct,
      ps.ogw_pct::float AS ogw_pct
    FROM player_stats ps
    JOIN tournaments t ON ps.tid = t.tid
    WHERE t.tournament_name ILIKE ${pattern}
    ${startFilter}
    ${endFilter}
  `;
  return computeBest8Leaderboard(rows).slice(0, 8);
}

/**
 * Quick summary stats for the analytics dashboard.
 */
export async function getOverviewStats(days: number = 90, range?: DateRangeFilter) {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - days * DAY_IN_SECONDS;
  const startDateUnix = range?.startDateUnix ?? cutoff;
  const endFilter = range?.endDateUnixExclusive !== undefined
    ? db`AND t.start_date < ${range.endDateUnixExclusive}`
    : db``;

  const [stats] = await db`
    SELECT
      COUNT(DISTINCT t.tid)::int AS total_tournaments,
      COALESCE(SUM(t.players), 0)::int AS total_entries,
      ROUND(AVG(t.players)::numeric, 1)::float AS avg_field_size,
      COUNT(DISTINCT ps.player_name)::int AS unique_players
    FROM tournaments t
    LEFT JOIN player_stats ps ON t.tid = ps.tid
    WHERE t.start_date >= ${startDateUnix}
    ${endFilter}
  `;

  return {
    totalTournaments: stats.total_tournaments ?? 0,
    totalEntries: stats.total_entries ?? 0,
    avgFieldSize: stats.avg_field_size ?? 0,
    uniquePlayers: stats.unique_players ?? 0,
  };
}

/**
 * Get a player's per-deck win rate breakdown for tournaments in a given season.
 * Handles player name aliases by querying all known name variants.
 */
export async function getPlayerDeckStatsBySeason(
  playerName: string,
  keyword: string,
  range?: DateRangeFilter,
): Promise<PlayerDeckStatEntry[]> {
  const db = getDb();
  const pattern = `%${keyword}%`;
  const names = getAliasesForCanonicalName(playerName);
  const namesLower = names.map((name) => name.toLowerCase());
  const startFilter = range?.startDateUnix !== undefined
    ? db`AND t.start_date >= ${range.startDateUnix}`
    : db``;
  const endFilter = range?.endDateUnixExclusive !== undefined
    ? db`AND t.start_date < ${range.endDateUnixExclusive}`
    : db``;

  const rows = await db<PlayerDeckStatEntry[]>`
    SELECT
      COALESCE(ps.deck_archetype, 'Unknown') AS deck_archetype,
      SUM(ps.wins_swiss)::int AS wins,
      SUM(ps.losses_swiss)::int AS losses,
      SUM(ps.draws)::int AS draws,
      COUNT(DISTINCT ps.tid)::int AS tournaments,
      ROUND(
        SUM(ps.wins_swiss)::numeric /
        NULLIF(SUM(ps.wins_swiss) + SUM(ps.losses_swiss) + SUM(ps.draws), 0) * 100,
        1
      )::float AS win_rate
    FROM player_stats ps
    JOIN tournaments t ON ps.tid = t.tid
    WHERE t.tournament_name ILIKE ${pattern}
      ${startFilter}
      ${endFilter}
      AND LOWER(ps.player_name) = ANY(${namesLower})
    GROUP BY COALESCE(ps.deck_archetype, 'Unknown')
    ORDER BY wins DESC, win_rate DESC
  `;
  return rows;
}

/**
 * Get a player's per-deck win rate breakdown for a rolling time window.
 */
export async function getPlayerDeckStatsByDays(
  playerName: string,
  days: number,
  range?: DateRangeFilter,
): Promise<PlayerDeckStatEntry[]> {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - days * DAY_IN_SECONDS;
  const names = getAliasesForCanonicalName(playerName);
  const namesLower = names.map((name) => name.toLowerCase());
  const startDateUnix = range?.startDateUnix ?? cutoff;
  const endFilter = range?.endDateUnixExclusive !== undefined
    ? db`AND t.start_date < ${range.endDateUnixExclusive}`
    : db``;

  const rows = await db<PlayerDeckStatEntry[]>`
    SELECT
      COALESCE(ps.deck_archetype, 'Unknown') AS deck_archetype,
      SUM(ps.wins_swiss)::int AS wins,
      SUM(ps.losses_swiss)::int AS losses,
      SUM(ps.draws)::int AS draws,
      COUNT(DISTINCT ps.tid)::int AS tournaments,
      ROUND(
        SUM(ps.wins_swiss)::numeric /
        NULLIF(SUM(ps.wins_swiss) + SUM(ps.losses_swiss) + SUM(ps.draws), 0) * 100,
        1
      )::float AS win_rate
    FROM player_stats ps
    JOIN tournaments t ON ps.tid = t.tid
    WHERE t.start_date >= ${startDateUnix}
      ${endFilter}
      AND LOWER(ps.player_name) = ANY(${namesLower})
    GROUP BY COALESCE(ps.deck_archetype, 'Unknown')
    ORDER BY wins DESC, win_rate DESC
  `;
  return rows;
}

/**
 * Get a player's per-deck stats, but only from the exact top-8 counted
 * tournament performances used for Best-8 ranking.
 */
export async function getPlayerDeckStatsBySeasonTop8(
  playerName: string,
  keyword: string,
  range?: DateRangeFilter,
): Promise<PlayerDeckStatEntry[]> {
  const db = getDb();
  const pattern = `%${keyword}%`;
  const names = getAliasesForCanonicalName(playerName);
  const namesLower = names.map((name) => name.toLowerCase());
  const startFilter = range?.startDateUnix !== undefined
    ? db`AND t.start_date >= ${range.startDateUnix}`
    : db``;
  const endFilter = range?.endDateUnixExclusive !== undefined
    ? db`AND t.start_date < ${range.endDateUnixExclusive}`
    : db``;

  const rows = await db<TournamentDeckScore[]>`
    SELECT
      ps.tid,
      (ps.wins_swiss * 3 + ps.draws)::int AS tournament_points,
      ps.wins_swiss::int AS wins,
      ps.losses_swiss::int AS losses,
      ps.draws::int AS draws,
      COALESCE(ps.deck_archetype, 'Unknown') AS deck_archetype
    FROM player_stats ps
    JOIN tournaments t ON ps.tid = t.tid
    WHERE t.tournament_name ILIKE ${pattern}
      ${startFilter}
      ${endFilter}
      AND LOWER(ps.player_name) = ANY(${namesLower})
  `;

  const top8Rows = rows
    .sort((a, b) => b.tournament_points - a.tournament_points)
    .slice(0, 8);

  const deckMap = new Map<string, { wins: number; losses: number; draws: number; tournaments: number }>();

  for (const row of top8Rows) {
    const deck = row.deck_archetype ?? "Unknown";
    const existing = deckMap.get(deck);
    if (!existing) {
      deckMap.set(deck, {
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
        tournaments: 1,
      });
      continue;
    }

    existing.wins += row.wins;
    existing.losses += row.losses;
    existing.draws += row.draws;
    existing.tournaments += 1;
  }

  return [...deckMap.entries()]
    .map(([deck_archetype, stats]) => {
      const totalGames = stats.wins + stats.losses + stats.draws;
      const win_rate = totalGames > 0
        ? Math.round((stats.wins / totalGames) * 1000) / 10
        : 0;

      return {
        deck_archetype,
        wins: stats.wins,
        losses: stats.losses,
        draws: stats.draws,
        tournaments: stats.tournaments,
        win_rate,
      } satisfies PlayerDeckStatEntry;
    })
    .sort((a, b) => b.wins - a.wins || b.win_rate - a.win_rate);
}
