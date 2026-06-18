/**
 * classify-unknowns.mjs
 *
 * Standalone script to re-classify "Unknown" deck archetypes in the database.
 * For each Unknown entry that has a decklist URL, fetches the full decklist
 * from Melee.gg and attempts to resolve the archetype via:
 *   1. DecklistName / Name / AiGeneratedName from the full decklist object
 *   2. Card-signature classification as fallback
 *
 * Usage:
 *   node scripts/classify-unknowns.mjs            # Apply changes to DB
 *   node scripts/classify-unknowns.mjs --dry-run  # Preview without writing
 *
 * Environment:
 *   DATABASE_URL, MELEE_API_CLIENT_ID, MELEE_API_CLIENT_SECRET
 */

import postgres from "postgres";
import { resolveArchetypeFromDecklist } from "./lib/archetype-classifier.mjs";

// --- Config ---

const DATABASE_URL = process.env.DATABASE_URL;
const MELEE_CLIENT_ID = process.env.MELEE_API_CLIENT_ID;
const MELEE_CLIENT_SECRET = process.env.MELEE_API_CLIENT_SECRET;
const DRY_RUN = process.argv.includes("--dry-run");
const REQUEST_DELAY_MS = 300;

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

// --- API helpers ---

async function fetchMeleeDecklist(decklistId) {
    const url = `https://melee.gg/api/decklist/${decklistId}`;
    const res = await fetch(url, {
        headers: { Authorization: AUTH_HEADER },
    });

    if (res.status === 429) {
        console.warn("  ⚠ Rate limited (429). Waiting 10s...");
        await new Promise((r) => setTimeout(r, 10000));
        return fetchMeleeDecklist(decklistId);
    }

    if (!res.ok) return null;
    return res.json();
}

async function fetchMoxfieldDecklist(publicId) {
    const url = `https://api2.moxfield.com/v2/decks/all/${publicId}`;
    const res = await fetch(url, {
        headers: { "User-Agent": "PauperOppKoelsch/1.0" },
    });

    if (res.status === 429) {
        console.warn("  ⚠ Moxfield rate limited. Waiting 5s...");
        await new Promise((r) => setTimeout(r, 5000));
        return fetchMoxfieldDecklist(publicId);
    }

    if (!res.ok) return null;
    return res.json();
}

/**
 * Extract DecklistId (GUID) from stored Melee decklist URL.
 * Format: https://melee.gg/Decklist/View/{guid}
 */
function extractMeleeDecklistId(url) {
    if (!url) return null;
    const match = url.match(/\/Decklist\/View\/([a-f0-9-]+)/i);
    return match ? match[1] : null;
}

/**
 * Extract Moxfield public ID from URL.
 * Format: https://www.moxfield.com/decks/{publicId}
 */
function extractMoxfieldId(url) {
    if (!url) return null;
    const match = url.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
}

/**
 * Convert Moxfield deck data to a format the classifier can use.
 * Moxfield returns cards in mainboard/sideboard objects.
 * Note: Moxfield `name` field is typically "PlayerName - EventName" (from SpiceRack),
 * NOT the deck archetype, so we skip it and rely on card classification.
 */
function moxfieldToClassifierFormat(moxData) {
    if (!moxData) return null;

    // Convert card data to Records format for the classifier
    const records = [];

    // Mainboard cards
    if (moxData.mainboard) {
        for (const [, card] of Object.entries(moxData.mainboard)) {
            records.push({
                n: card.card?.name || card.name || "",
                q: card.quantity || 1,
                c: 0, // maindeck
                t: card.card?.type || "",
            });
        }
    }

    // Sideboard cards
    if (moxData.sideboard) {
        for (const [, card] of Object.entries(moxData.sideboard)) {
            records.push({
                n: card.card?.name || card.name || "",
                q: card.quantity || 1,
                c: 99, // sideboard
                t: card.card?.type || "",
            });
        }
    }

    // Only pass Name/DecklistName/AiGeneratedName as null — force card classifier
    return { Name: null, DecklistName: null, AiGeneratedName: null, Records: records };
}

// --- Refresh meta snapshots (same as in fetch script) ---

async function refreshMetaSnapshots() {
    await sql.unsafe("DELETE FROM meta_snapshots");

    await sql.unsafe(`
      INSERT INTO deck_archetypes (name)
      SELECT DISTINCT deck_archetype FROM player_stats
      WHERE deck_archetype IS NOT NULL
      ON CONFLICT (name) DO NOTHING
    `);

    await sql.unsafe(`
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
    `);
}

// --- Main ---

async function main() {
    if (DRY_RUN) {
        console.log("🔍 DRY RUN mode — no changes will be written to the database.\n");
    }

    // Find all Unknown entries that have a decklist URL
    const unknowns = await sql.unsafe(`
        SELECT ps.id, ps.tid, ps.player_name, ps.decklist, t.tournament_name
        FROM player_stats ps
        JOIN tournaments t ON t.tid = ps.tid
        WHERE ps.deck_archetype = 'Unknown'
          AND ps.decklist IS NOT NULL
        ORDER BY t.start_date DESC, ps.player_name
    `);

    console.log(`📋 Found ${unknowns.length} "Unknown" entries with decklists to resolve.\n`);

    if (unknowns.length === 0) {
        console.log("Nothing to do.");
        await sql.end();
        return;
    }

    let resolved = 0;
    let failed = 0;
    const changes = [];

    for (const row of unknowns) {
        const meleeDecklistId = extractMeleeDecklistId(row.decklist);
        const moxfieldId = extractMoxfieldId(row.decklist);

        if (!meleeDecklistId && !moxfieldId) {
            failed++;
            continue;
        }

        try {
            let fullDecklist = null;

            if (meleeDecklistId) {
                // Melee.gg decklist
                fullDecklist = await fetchMeleeDecklist(meleeDecklistId);
            } else if (moxfieldId) {
                // Moxfield decklist — fetch and convert
                const moxData = await fetchMoxfieldDecklist(moxfieldId);
                fullDecklist = moxfieldToClassifierFormat(moxData);
            }

            if (!fullDecklist) {
                console.log(`  ⚠ Could not fetch decklist for ${row.player_name}`);
                failed++;
                await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
                continue;
            }

            const result = resolveArchetypeFromDecklist(fullDecklist);

            if (result.archetype !== "Unknown") {
                changes.push({
                    id: row.id,
                    playerName: row.player_name,
                    tournamentName: row.tournament_name,
                    tid: row.tid,
                    oldArchetype: "Unknown",
                    newArchetype: result.archetype,
                    source: result.source,
                    confidence: result.confidence,
                });

                const confStr = result.source === "card-classifier"
                    ? ` (confidence: ${result.confidence.toFixed(1)})`
                    : "";
                console.log(
                    `  ✓ ${row.player_name} (${row.tournament_name}): Unknown → ${result.archetype} [${result.source}]${confStr}`
                );
                resolved++;
            } else {
                console.log(`  – ${row.player_name} (${row.tournament_name}): still Unknown [${result.source}]`);
                failed++;
            }
        } catch (err) {
            console.error(`  ✗ Error processing ${row.player_name}: ${err.message}`);
            failed++;
        }

        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }

    console.log(`\n📊 Results: ${resolved} resolved, ${failed} still unknown out of ${unknowns.length} total.`);

    // Apply changes
    if (!DRY_RUN && changes.length > 0) {
        console.log("\n💾 Writing changes to database...");

        for (const change of changes) {
            // Ensure archetype exists in deck_archetypes table
            await sql.unsafe(
                `INSERT INTO deck_archetypes (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
                [change.newArchetype]
            );

            // Update player_stats
            await sql.unsafe(
                `UPDATE player_stats SET deck_archetype = $1 WHERE id = $2`,
                [change.newArchetype, change.id]
            );
        }

        console.log(`✅ Updated ${changes.length} rows.`);

        // Refresh meta snapshots
        console.log("\n📊 Refreshing meta snapshots...");
        await refreshMetaSnapshots();
        console.log("✅ Meta snapshots refreshed.");
    } else if (DRY_RUN && changes.length > 0) {
        console.log(`\n📝 Would update ${changes.length} rows (dry run, no changes written).`);
    }

    await sql.end();
}

main().catch((err) => {
    console.error("❌ Fatal error:", err);
    process.exit(1);
});
