import type { PlayerLeaderboardEntry, Best8LeaderboardEntry, TournamentScore } from "./analytics";

/**
 * Player alias mapping — maps variant names to a single canonical display name.
 * Key: lowercased alias, Value: canonical display name.
 *
 * When the same person registers with different name spellings on Melee.gg,
 * add their variants here so stats are consolidated correctly.
 */
export const PLAYER_ALIASES: Record<string, string> = {
  // Vittorio Tracanna
  "vittorio tracanna": "Vittorio Tracanna",

  // Tom Tom
  "tom tom": "Tom Tom",

  // Pascal Steinke (typo variant)
  "paacal steinke": "Pascal Steinke",

  // Robin Willhoff (single-f variant)
  "robin willhof": "Robin Willhoff",

  // Kai-Uwe Schutte (all short variants)
  "kai": "Kai-Uwe Schutte",
  "kai s": "Kai-Uwe Schutte",
  "kai schutte": "Kai-Uwe Schutte",

  // Kevin Titz
  "kevin t": "Kevin Titz",

  // Patrick Gertz
  "patrick g": "Patrick Gertz",

  // Andreas Hergert
  "andreas h": "Andreas Hergert",

  // Christian Brieden (all short/dot variants)
  "christian b": "Christian Brieden",
  "christian b.": "Christian Brieden",
  "christian bieneck": "Christian Brieden",

  // Dominik Baggeler
  "dominik b": "Dominik Baggeler",

  // Philip Odendahl
  "philip o": "Philip Odendahl",

  // Josua Kreuzmann
  "josua k": "Josua Kreuzmann",
  "j k": "Josua Kreuzmann",

  // Jorge Mingorance Moreno
  "jorge mingorance": "Jorge Mingorance Moreno",

  // Jasper Ries-Viherjuuri
  "jasper ries": "Jasper Ries-Viherjuuri",

  // Fynn-Ole Callsen
  "ole callsen": "Fynn-Ole Callsen",

  // Lukas Drees
  "lukas d.": "Lukas Drees",
};

/**
 * Resolve a player name to its canonical form.
 * Uses case-insensitive lookup.
 */
export function normalizePlayerName(name: string): string {
  return PLAYER_ALIASES[name.toLowerCase().trim()] ?? name;
}

/**
 * Consolidate a player leaderboard by merging rows that share a canonical name.
 * Re-aggregates wins/losses/draws/tournaments and recalculates derived fields.
 */
export function consolidatePlayerLeaderboard(
  entries: PlayerLeaderboardEntry[],
): PlayerLeaderboardEntry[] {
  const map = new Map<string, PlayerLeaderboardEntry>();

  for (const entry of entries) {
    const canonical = normalizePlayerName(entry.player_name);
    const existing = map.get(canonical);

    if (!existing) {
      map.set(canonical, { ...entry, player_name: canonical });
    } else {
      existing.tournaments_played += entry.tournaments_played;
      existing.total_wins += entry.total_wins;
      existing.total_losses += entry.total_losses;
      existing.total_draws += entry.total_draws;
      existing.total_games += entry.total_games;
      existing.points = existing.total_wins * 3 + existing.total_draws;
      existing.win_rate =
        existing.total_games > 0
          ? Math.round((existing.total_wins / existing.total_games) * 10000) / 100
          : 0;
      existing.points_per_game =
        existing.total_games > 0
          ? Math.round((existing.points / existing.total_games) * 100) / 100
          : 0;
    }
  }

  return [...map.values()].sort(
    (a, b) => b.points - a.points || b.win_rate - a.win_rate,
  );
}

/**
 * Compute the Best-8 leaderboard from raw per-tournament scores.
 * Normalizes player names first, then picks each player's top 8 tournament
 * scores to sum — so aliases are correctly merged before ranking.
 */
export function computeBest8Leaderboard(
  scores: TournamentScore[],
): Best8LeaderboardEntry[] {
  const average = (values: number[]): number | null => {
    if (values.length === 0) return null;
    const total = values.reduce((sum, v) => sum + v, 0);
    return Math.round((total / values.length) * 10000) / 10000;
  };

  const tieValue = (value: number | null): number =>
    value === null ? -1 : value;

  // Group all tournament scores by canonical player name
  const playerScores = new Map<string, TournamentScore[]>();

  for (const score of scores) {
    const canonical = normalizePlayerName(score.player_name);
    if (!playerScores.has(canonical)) playerScores.set(canonical, []);
    playerScores.get(canonical)!.push(score);
  }

  const result: Best8LeaderboardEntry[] = [];

  for (const [name, allScores] of playerScores) {
    const tournamentsPlayed = new Set(allScores.map((s) => s.tid)).size;

    // Sort by tournament_points descending and take the top 8
    const top8 = allScores
      .sort((a, b) => b.tournament_points - a.tournament_points)
      .slice(0, 8);

    result.push({
      player_name: name,
      best8_points: top8.reduce((sum, s) => sum + s.tournament_points, 0),
      best8_wins: top8.reduce((sum, s) => sum + s.wins, 0),
      best8_losses: top8.reduce((sum, s) => sum + s.losses, 0),
      best8_draws: top8.reduce((sum, s) => sum + s.draws, 0),
      avg_omw_pct: average(
        top8
          .map((s) => s.omw_pct)
          .filter((v): v is number => v !== null && Number.isFinite(v)),
      ),
      avg_tgw_pct: average(
        top8
          .map((s) => s.tgw_pct)
          .filter((v): v is number => v !== null && Number.isFinite(v)),
      ),
      avg_ogw_pct: average(
        top8
          .map((s) => s.ogw_pct)
          .filter((v): v is number => v !== null && Number.isFinite(v)),
      ),
      tournaments_counted: top8.length,
      tournaments_played: tournamentsPlayed,
    });
  }

  return result.sort(
    (a, b) =>
      b.best8_points - a.best8_points ||
      b.best8_wins - a.best8_wins ||
      tieValue(b.avg_omw_pct) - tieValue(a.avg_omw_pct) ||
      tieValue(b.avg_tgw_pct) - tieValue(a.avg_tgw_pct) ||
      tieValue(b.avg_ogw_pct) - tieValue(a.avg_ogw_pct) ||
      a.best8_losses - b.best8_losses ||
      b.best8_draws - a.best8_draws ||
      a.player_name.localeCompare(b.player_name),
  );
}
