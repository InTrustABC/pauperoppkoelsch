import type { APIRoute } from "astro";
import { getPlayerDeckStatsBySeason, getPlayerDeckStatsByDays } from "../../lib/analytics";

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const player = url.searchParams.get("player");
  const season = url.searchParams.get("season");
  const daysParam = url.searchParams.get("days");

  if (!player || (!season && !daysParam)) {
    return new Response(
      JSON.stringify({ error: "player and either season or days are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const data = season
      ? await getPlayerDeckStatsBySeason(player, season)
      : await getPlayerDeckStatsByDays(player, Math.max(1, parseInt(daysParam!, 10)));
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
