/**
 * archetype-classifier.mjs
 *
 * Classifies Pauper decklists by matching card contents against
 * known archetype signatures. Uses a scoring system where each
 * signature card match counts as a point; the archetype with the
 * highest score wins (minimum threshold of 2 matches required).
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const signaturesPath = join(__dirname, "pauper-signatures.json");

let signatures = null;

function loadSignatures() {
    if (!signatures) {
        signatures = JSON.parse(readFileSync(signaturesPath, "utf-8"));
    }
    return signatures;
}

/**
 * Classify a decklist based on its card records from the Melee.gg API.
 *
 * @param {Array<{n: string, q: number, c: number, t: string}>} records
 *   The `Records[]` array from a Melee.gg decklist response.
 *   Each entry has: n = card name, q = quantity, c = category (0=main, 99=sideboard), t = type.
 *
 * @returns {{ archetype: string, confidence: number, totalSignatures: number }}
 *   The best matching archetype, or "Unknown" if no match meets the threshold.
 */
export function classifyByCards(records) {
    if (!records || !Array.isArray(records) || records.length === 0) {
        return { archetype: "Unknown", confidence: 0, totalSignatures: 0 };
    }

    const sigs = loadSignatures();

    // Build a set of card names in the maindeck (c === 0 or no category)
    const maindeckCards = new Set(
        records
            .filter((r) => r.c === 0 || r.c === undefined)
            .map((r) => r.n?.toLowerCase())
            .filter(Boolean)
    );

    // Also include sideboard for broader matching
    const allCards = new Set(
        records.map((r) => r.n?.toLowerCase()).filter(Boolean)
    );

    let bestArchetype = "Unknown";
    let bestScore = 0;
    let bestTotal = 0;

    for (const [archetype, config] of Object.entries(sigs)) {
        const sigCards = config.signatures;
        const weight = config.weight || 1;

        let score = 0;
        for (const sig of sigCards) {
            // Check maindeck first (worth full point), sideboard (worth 0.5)
            if (maindeckCards.has(sig.toLowerCase())) {
                score += 1 * weight;
            } else if (allCards.has(sig.toLowerCase())) {
                score += 0.5 * weight;
            }
        }

        if (score > bestScore) {
            bestScore = score;
            bestArchetype = archetype;
            bestTotal = sigCards.length;
        }
    }

    // Minimum threshold: at least 2 full signature matches
    if (bestScore < 2) {
        return { archetype: "Unknown", confidence: 0, totalSignatures: 0 };
    }

    return {
        archetype: bestArchetype,
        confidence: bestScore,
        totalSignatures: bestTotal,
    };
}

/**
 * Try to resolve an archetype from a full Melee.gg decklist response object.
 * Priority: DecklistName → Name → AiGeneratedName → card classifier.
 *
 * @param {object} fullDecklist - The full decklist object from /api/decklist/{id}
 * @returns {{ archetype: string, source: string, confidence: number }}
 */
export function resolveArchetypeFromDecklist(fullDecklist) {
    if (!fullDecklist) {
        return { archetype: "Unknown", source: "no-data", confidence: 0 };
    }

    // Priority 1: DecklistName
    if (fullDecklist.DecklistName && fullDecklist.DecklistName.trim()) {
        return { archetype: fullDecklist.DecklistName.trim(), source: "DecklistName", confidence: 1 };
    }

    // Priority 2: Name
    if (fullDecklist.Name && fullDecklist.Name.trim()) {
        return { archetype: fullDecklist.Name.trim(), source: "Name", confidence: 1 };
    }

    // Priority 3: AiGeneratedName
    if (fullDecklist.AiGeneratedName && fullDecklist.AiGeneratedName.trim()) {
        return { archetype: fullDecklist.AiGeneratedName.trim(), source: "AiGeneratedName", confidence: 0.9 };
    }

    // Priority 4: Card-based classification
    if (fullDecklist.Records && fullDecklist.Records.length > 0) {
        const result = classifyByCards(fullDecklist.Records);
        return { archetype: result.archetype, source: "card-classifier", confidence: result.confidence };
    }

    return { archetype: "Unknown", source: "no-match", confidence: 0 };
}
