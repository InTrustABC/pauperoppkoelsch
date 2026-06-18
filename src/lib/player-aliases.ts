import type { PlayerLeaderboardEntry, Best8LeaderboardEntry } from "./analytics";

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
 * Consolidate a Best-8 leaderboard by merging aliased player rows.
 * Sums points/wins/losses/draws and caps tournaments_counted at 8.
 */
export function consolidateBest8Leaderboard(
  entries: Best8LeaderboardEntry[],
): Best8LeaderboardEntry[] {
  const map = new Map<string, Best8LeaderboardEntry>();

  for (const entry of entries) {
    const canonical = normalizePlayerName(entry.player_name);
    const existing = map.get(canonical);

    if (!existing) {
      map.set(canonical, { ...entry, player_name: canonical });
    } else {
      existing.best8_points += entry.best8_points;
      existing.best8_wins += entry.best8_wins;
      existing.best8_losses += entry.best8_losses;
      existing.best8_draws += entry.best8_draws;
      existing.tournaments_counted = Math.min(
        8,
        existing.tournaments_counted + entry.tournaments_counted,
      );
      existing.tournaments_played += entry.tournaments_played;
    }
  }

  return [...map.values()].sort(
    (a, b) => b.best8_points - a.best8_points || b.best8_wins - a.best8_wins,
  );
}
