import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const SEASON = "Verdant Season";

const PLAYER_ALIASES = {
  "vittorio tracanna": "Vittorio Tracanna",
  "tom tom": "Tom Tom",
  "paacal steinke": "Pascal Steinke",
  "robin willhof": "Robin Willhoff",
  "kai": "Kai-Uwe Schutte",
  "kai s": "Kai-Uwe Schutte",
  "kai schutte": "Kai-Uwe Schutte",
  "kevin t": "Kevin Titz",
  "patrick g": "Patrick Gertz",
  "andreas h": "Andreas Hergert",
  "christian b": "Christian Brieden",
  "christian b.": "Christian Brieden",
  "christian bieneck": "Christian Brieden",
  "dominik b": "Dominik Baggeler",
  "philip o": "Philip Odendahl",
  "josua k": "Josua Kreuzmann",
  "j k": "Josua Kreuzmann",
  "jorge mingorance": "Jorge Mingorance Moreno",
  "jasper ries": "Jasper Ries-Viherjuuri",
  "ole callsen": "Fynn-Ole Callsen",
  "lukas d.": "Lukas Drees",
};

function normalizePlayerName(name) {
  return PLAYER_ALIASES[name.toLowerCase().trim()] ?? name;
}

function computeBest8Leaderboard(scores) {
  const playerScores = new Map();

  for (const score of scores) {
    const canonical = normalizePlayerName(score.player_name);
    if (!playerScores.has(canonical)) playerScores.set(canonical, []);
    playerScores.get(canonical).push(score);
  }

  const result = [];

  for (const [name, allScores] of playerScores) {
    const tournamentsPlayed = new Set(allScores.map((s) => s.tid)).size;
    const sortedByPoints = [...allScores].sort(
      (a, b) => b.tournament_points - a.tournament_points,
    );
    const top8 = sortedByPoints.slice(0, 8);
    const best8Points = top8.reduce((sum, s) => sum + s.tournament_points, 0);
    const best8Wins = top8.reduce((sum, s) => sum + s.wins, 0);
    const best8Losses = top8.reduce((sum, s) => sum + s.losses, 0);
    const best8Draws = top8.reduce((sum, s) => sum + s.draws, 0);
    const best8Games = best8Wins + best8Losses + best8Draws;
    const best8WinRate = best8Games > 0 ? (best8Wins / best8Games) * 100 : 0;
    const best8Ppg = best8Games > 0 ? best8Points / best8Games : 0;

    result.push({
      player_name: name,
      best8_points: best8Points,
      best8_wins: best8Wins,
      best8_losses: best8Losses,
      best8_draws: best8Draws,
      best8_games: best8Games,
      best8_winrate: best8WinRate,
      best8_ppg: best8Ppg,
      tournaments_counted: top8.length,
      tournaments_played: tournamentsPlayed,
      top8_scores: top8.map((s) => s.tournament_points),
    });
  }

  return result.sort(
    (a, b) => b.best8_points - a.best8_points || b.best8_wins - a.best8_wins,
  );
}

const seasonPattern = `%${SEASON}%`;

const tournaments = await sql`
  SELECT tid, tournament_name, TO_CHAR(TO_TIMESTAMP(start_date), 'YYYY-MM-DD') AS date
  FROM tournaments
  WHERE tournament_name ILIKE ${seasonPattern}
  ORDER BY start_date ASC
`;

const rows = await sql`
  SELECT
    ps.player_name,
    ps.tid,
    (ps.wins_swiss * 3 + ps.draws)::int AS tournament_points,
    ps.wins_swiss::int AS wins,
    ps.losses_swiss::int AS losses,
    ps.draws::int AS draws
  FROM player_stats ps
  JOIN tournaments t ON ps.tid = t.tid
  WHERE t.tournament_name ILIKE ${seasonPattern}
`;

const ranked = computeBest8Leaderboard(rows);

console.log(`Season filter: ${SEASON}`);
console.log(`Tournaments used: ${tournaments.length}`);
for (const t of tournaments) {
  console.log(`  ${t.date}  ${t.tournament_name}`);
}

console.log("\nTop 12 by current rule (points desc, wins desc):");
ranked.slice(0, 12).forEach((p, idx) => {
  console.log(
    `${String(idx + 1).padStart(2)}. ${p.player_name.padEnd(26)} ` +
      `Pts:${String(p.best8_points).padStart(3)} ` +
      `W:${String(p.best8_wins).padStart(2)} ` +
      `L:${String(p.best8_losses).padStart(2)} ` +
      `D:${String(p.best8_draws).padStart(2)} ` +
      `WR:${p.best8_winrate.toFixed(2).padStart(6)}% ` +
      `PPG:${p.best8_ppg.toFixed(3)} ` +
      `Counted:${p.tournaments_counted}/${p.tournaments_played}`,
  );
});

const rank8 = ranked[7];
const rank9 = ranked[8];

if (!rank8 || !rank9) {
  console.log("\nNot enough players to evaluate rank-8 cutoff tie.");
  await sql.end();
  process.exit(0);
}

console.log("\nCutoff check (rank 8 vs rank 9):");
console.log(
  `#8 ${rank8.player_name}: ${rank8.best8_points} pts, ${rank8.best8_wins} wins, ` +
    `${rank8.best8_losses} losses, ${rank8.best8_draws} draws, ` +
    `WR ${rank8.best8_winrate.toFixed(2)}%, PPG ${rank8.best8_ppg.toFixed(3)}`,
);
console.log(
  `#9 ${rank9.player_name}: ${rank9.best8_points} pts, ${rank9.best8_wins} wins, ` +
    `${rank9.best8_losses} losses, ${rank9.best8_draws} draws, ` +
    `WR ${rank9.best8_winrate.toFixed(2)}%, PPG ${rank9.best8_ppg.toFixed(3)}`,
);

const tiedOnPoints = ranked.filter((p) => p.best8_points === rank8.best8_points);
const tiedOnPointsAndWins = ranked.filter(
  (p) =>
    p.best8_points === rank8.best8_points &&
    p.best8_wins === rank8.best8_wins,
);

console.log("\nTie analysis around cutoff:");
console.log(`Players tied with rank 8 on points: ${tiedOnPoints.length}`);
for (const p of tiedOnPoints) {
  const pos = ranked.findIndex((x) => x.player_name === p.player_name) + 1;
  console.log(
    `  #${pos} ${p.player_name}: ${p.best8_points} pts, ${p.best8_wins}W-${p.best8_losses}L-${p.best8_draws}D`,
  );
}

console.log(`Players tied with rank 8 on points and wins: ${tiedOnPointsAndWins.length}`);
for (const p of tiedOnPointsAndWins) {
  const pos = ranked.findIndex((x) => x.player_name === p.player_name) + 1;
  console.log(
    `  #${pos} ${p.player_name}: ${p.best8_points} pts, ${p.best8_wins}W-${p.best8_losses}L-${p.best8_draws}D`,
  );
}

if (tiedOnPointsAndWins.length > 1) {
  const alt = [...tiedOnPointsAndWins].sort(
    (a, b) =>
      b.best8_points - a.best8_points ||
      b.best8_wins - a.best8_wins ||
      b.best8_draws - a.best8_draws ||
      a.best8_losses - b.best8_losses ||
      b.best8_ppg - a.best8_ppg ||
      a.player_name.localeCompare(b.player_name),
  );
  console.log("\nSuggested deterministic tie-break among tied players:");
  alt.forEach((p, i) => {
    console.log(
      `  ${i + 1}) ${p.player_name} | ` +
        `${p.best8_points} pts, ${p.best8_wins}W-${p.best8_losses}L-${p.best8_draws}D, ` +
        `PPG ${p.best8_ppg.toFixed(3)}`,
    );
  });
}

await sql.end();
