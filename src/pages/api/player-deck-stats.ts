import type { APIRoute } from "astro";
import {
  getPlayerDeckStatsBySeason,
  getPlayerDeckStatsByDays,
  getPlayerDeckStatsBySeasonTop8,
  getTodayIsoDate,
  resolveDateRange,
} from "../../lib/analytics";

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const player = url.searchParams.get("player");
  const season = url.searchParams.get("season");
  const daysParam = url.searchParams.get("days");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const top8Param = url.searchParams.get("top8");
  const top8Only = top8Param === "1" || top8Param === "true";
  const hasDateRange = Boolean(fromParam || toParam);

  if (!player || (!season && !daysParam && !hasDateRange)) {
    return new Response(
      JSON.stringify({ error: "player and either season, days, or date range are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    if (top8Only && !season) {
      return new Response(
        JSON.stringify({ error: "top8 mode requires season" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const dateRange = hasDateRange
      ? resolveDateRange({
          fromParam,
          toParam,
          defaultFrom: fromParam ?? toParam ?? getTodayIsoDate(),
          defaultTo: getTodayIsoDate(),
        })
      : null;
    const rangeFilter = dateRange
      ? {
          startDateUnix: dateRange.startDateUnix,
          endDateUnixExclusive: dateRange.endDateUnixExclusive,
        }
      : undefined;

    const parsedDays = daysParam ? Math.max(1, parseInt(daysParam, 10)) : 365;

    const data = top8Only && season
      ? await getPlayerDeckStatsBySeasonTop8(player, season, rangeFilter)
      : season
      ? await getPlayerDeckStatsBySeason(player, season, rangeFilter)
      : await getPlayerDeckStatsByDays(player, parsedDays, rangeFilter);
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
