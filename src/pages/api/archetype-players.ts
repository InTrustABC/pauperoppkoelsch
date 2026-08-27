import type { APIRoute } from "astro";
import {
  getArchetypePlayers,
  resolveDateRange,
  getTodayIsoDate,
} from "../../lib/analytics";

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const archetype = url.searchParams.get("archetype");
  const season = url.searchParams.get("season") ?? undefined;
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  if (!archetype) {
    return new Response(JSON.stringify({ error: "archetype is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const range =
      fromParam || toParam
        ? resolveDateRange({
            fromParam,
            toParam,
            defaultFrom: fromParam ?? getTodayIsoDate(),
            defaultTo: getTodayIsoDate(),
          })
        : null;

    const rangeFilter = range
      ? {
          startDateUnix: range.startDateUnix,
          endDateUnixExclusive: range.endDateUnixExclusive,
        }
      : undefined;

    const data = await getArchetypePlayers(archetype, rangeFilter, season);
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
