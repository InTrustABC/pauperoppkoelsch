/**
 * Shared player deck breakdown modal — browser-side module.
 * Creates a single modal DOM element on demand and reuses it across charts.
 * Imported by chart components that want click-to-deck-breakdown functionality.
 */
import {
    Chart,
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    Tooltip,
} from "chart.js";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const MODAL_ID = "sharedPlayerDeckModal";
const STYLES_ID = "playerDeckModalCSS";

interface DeckStat {
    deck_archetype: string;
    wins: number;
    losses: number;
    draws: number;
    tournaments: number;
    win_rate: number;
}

let deckChartInstance: Chart | null = null;

function formatDateForDisplay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }
  return `${match[3]}.${match[2]}.${match[1]}`;
}

// reads the lang set server-side by Layout.astro
function uiLocale(): 'de' | 'en' {
    return document.documentElement.lang === 'en' ? 'en' : 'de';
}

function t(de: string, en: string): string {
    return uiLocale() === 'en' ? en : de;
}

function injectStyles(): void {
    if (document.getElementById(STYLES_ID)) return;
    const style = document.createElement("style");
    style.id = STYLES_ID;
    style.textContent = `
    #${MODAL_ID}.deck-modal-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .deck-modal-card {
      background: #1e1e2e;
      color: #e2e8f0;
      border-radius: 0.75rem;
      padding: 1.5rem;
      width: 100%;
      max-width: 580px;
      max-height: 82vh;
      overflow-y: auto;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
    }
    .deck-modal-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .deck-modal-title {
      font-size: 0.95rem;
      font-weight: 600;
      margin: 0;
      line-height: 1.4;
    }
    .deck-modal-close {
      flex-shrink: 0;
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 1.1rem;
      line-height: 1;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
    }
    .deck-modal-close:hover {
      color: #e2e8f0;
      background: rgba(255, 255, 255, 0.08);
    }
    .deck-modal-loading {
      text-align: center;
      padding: 1.5rem 0;
      color: #94a3b8;
      font-size: 0.875rem;
    }
    .deck-modal-error {
      display: none;
      text-align: center;
      padding: 0.75rem 0;
      color: #ef4444;
      font-size: 0.875rem;
    }
    .deck-chart-inner {
      display: none;
      position: relative;
      width: 100%;
      margin-bottom: 1.25rem;
    }
    .deck-table-wrapper { overflow-x: auto; }
    .deck-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    .deck-table th,
    .deck-table td {
      text-align: left;
      padding: 0.45rem 0.75rem;
      border-bottom: 1px solid #2d3748;
    }
    .deck-table th {
      color: #94a3b8;
      font-weight: 500;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .deck-table tbody tr:hover { background: rgba(255, 255, 255, 0.04); }
  `;
    document.head.appendChild(style);
}

function getOrCreateModal(): HTMLElement {
    const existing = document.getElementById(MODAL_ID);
    if (existing) return existing;

    injectStyles();

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "deck-modal-backdrop";
    modal.innerHTML = `
    <div class="deck-modal-card">
      <div class="deck-modal-header">
        <h4 id="playerDeckModalTitle" class="deck-modal-title"></h4>
        <button id="playerDeckModalClose" class="deck-modal-close" aria-label="${t('Schlie\u00dfen', 'Close')}">\u2715</button>
      </div>
      <div id="playerDeckLoading" class="deck-modal-loading">${t('Lade Daten\u2026', 'Loading\u2026')}</div>
      <div id="playerDeckError" class="deck-modal-error"></div>
      <div id="playerDeckChartContainer" class="deck-chart-inner">
        <canvas id="playerDeckChartCanvas"></canvas>
      </div>
      <div class="deck-table-wrapper">
        <table class="deck-table">
          <thead>
            <tr>
              <th>Deck</th>
              <th>${t('Bilanz', 'Record')}</th>
              <th>Win Rate</th>
              <th>${t('Turniere', 'Tournaments')}</th>
            </tr>
          </thead>
          <tbody id="playerDeckTableBody"></tbody>
        </table>
      </div>
    </div>
  `;
    document.body.appendChild(modal);

    (document.getElementById("playerDeckModalClose") as HTMLButtonElement).onclick =
        closePlayerDeckModal;
    modal.onclick = (e) => {
        if (e.target === modal) closePlayerDeckModal();
    };

    return modal;
}

export function closePlayerDeckModal(): void {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.style.display = "none";
    if (deckChartInstance) {
        deckChartInstance.destroy();
        deckChartInstance = null;
    }
}

export async function openPlayerDeckModal(
    playerName: string,
    season?: string,
    days?: number,
    from?: string,
    to?: string,
    top8Only?: boolean,
): Promise<void> {
    const modal = getOrCreateModal();
    const titleEl = document.getElementById("playerDeckModalTitle") as HTMLElement;
    const canvas = document.getElementById(
        "playerDeckChartCanvas",
    ) as HTMLCanvasElement;
    const container = document.getElementById(
        "playerDeckChartContainer",
    ) as HTMLElement;
    const tbody = document.getElementById("playerDeckTableBody") as HTMLElement;
    const loadingEl = document.getElementById("playerDeckLoading") as HTMLElement;
    const errorEl = document.getElementById("playerDeckError") as HTMLElement;

    const filterParts: string[] = [];
    if (season) {
      filterParts.push(season);
    } else if (days) {
      filterParts.push(`${days} ${t('Tage', 'Days')}`);
    }
    if (from && to) {
      filterParts.push(`${formatDateForDisplay(from)} ${t('bis', 'to')} ${formatDateForDisplay(to)}`);
    }
    if (top8Only) {
      filterParts.push(t('Top 8 gewertet', 'Top 8 only'));
    }
    const filterLabel = filterParts.join(" | ");
    titleEl.textContent = `${playerName} \u2014 Decks (${filterLabel})`;
    tbody.innerHTML = "";
    loadingEl.style.display = "block";
    errorEl.style.display = "none";
    errorEl.textContent = "";
    container.style.display = "none";
    modal.style.display = "flex";

    if (deckChartInstance) {
        deckChartInstance.destroy();
        deckChartInstance = null;
    }

    try {
        const params = new URLSearchParams({ player: playerName });
        if (season) params.set("season", season);
        else if (days) params.set("days", String(days));
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        if (top8Only) params.set("top8", "1");

        const res = await fetch(`/api/player-deck-stats?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: DeckStat[] = await res.json();

        loadingEl.style.display = "none";

        if (!data.length) {
            errorEl.textContent = t('Keine Deck-Daten f\u00fcr diesen Spieler.', 'No deck data for this player.');
            errorEl.style.display = "block";
            return;
        }

        const chartHeight = Math.max(160, data.length * 36);
        container.style.height = `${chartHeight}px`;
        container.style.display = "block";

        deckChartInstance = new Chart(canvas, {
            type: "bar",
            data: {
                labels: data.map((d) => d.deck_archetype),
                datasets: [
                    {
                        label: "Win Rate (%)",
                        data: data.map((d) => d.win_rate),
                        backgroundColor: data.map((d) =>
                            d.win_rate >= 60
                                ? "#10b981"
                                : d.win_rate >= 50
                                  ? "#3b82f6"
                                  : d.win_rate >= 40
                                    ? "#f59e0b"
                                    : "#ef4444",
                        ),
                        borderWidth: 1,
                        borderColor: "#fff",
                        borderRadius: 3,
                    },
                ],
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        beginAtZero: true,
                        max: 100,
                        title: { display: true, text: "Win Rate (%)" },
                    },
                    y: { ticks: { font: { size: 11 } } },
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const d = data[ctx.dataIndex];
                                return ` ${d.win_rate}% (${d.wins}W-${d.losses}L-${d.draws}D)`;
                            },
                        },
                    },
                },
            },
        });

        for (const d of data) {
            const tr = document.createElement("tr");
            tr.innerHTML = `
        <td>${d.deck_archetype}</td>
        <td>${d.wins}W-${d.losses}L-${d.draws}D</td>
        <td>${d.win_rate}%</td>
        <td>${d.tournaments}</td>
      `;
            tbody.appendChild(tr);
        }
    } catch (err) {
        loadingEl.style.display = "none";
        errorEl.textContent = `${t('Fehler', 'Error')}: ${err instanceof Error ? err.message : t('Unbekannt', 'Unknown')}`;
        errorEl.style.display = "block";
    }
}

// --- Archetype detail modal ---

const ARCHETYPE_MODAL_ID = "sharedArchetypeModal";
const ARCHETYPE_STYLES_ID = "archetypeModalCSS";

interface ArchetypePlayerRow {
    player_name: string;
    tournament_name: string;
    tournament_date: string;
    wins: number;
    losses: number;
    draws: number;
    win_rate: number | null;
    decklist: string | null;
}

function injectArchetypeStyles(): void {
    if (document.getElementById(ARCHETYPE_STYLES_ID)) return;
    const style = document.createElement("style");
    style.id = ARCHETYPE_STYLES_ID;
    style.textContent = `
    #${ARCHETYPE_MODAL_ID}.archetype-modal-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.65);
      z-index: 1001;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .archetype-modal-card {
      background: #1e1e2e;
      color: #e2e8f0;
      border-radius: 0.75rem;
      padding: 1.5rem;
      width: 100%;
      max-width: 660px;
      max-height: 82vh;
      overflow-y: auto;
      box-shadow: 0 24px 64px rgba(0,0,0,0.55);
    }
    .archetype-modal-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 0.75rem;
    }
    .archetype-modal-title-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .archetype-modal-swatch {
      display: inline-block;
      width: 13px;
      height: 13px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .archetype-modal-title {
      font-size: 1rem;
      font-weight: 700;
      margin: 0;
    }
    .archetype-modal-close {
      flex-shrink: 0;
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 1.1rem;
      line-height: 1;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
    }
    .archetype-modal-close:hover {
      color: #e2e8f0;
      background: rgba(255,255,255,0.08);
    }
    .archetype-modal-meta {
      font-size: 0.82rem;
      color: #94a3b8;
      margin: 0 0 1rem;
    }
    .archetype-modal-loading {
      text-align: center;
      padding: 1.5rem 0;
      color: #94a3b8;
      font-size: 0.875rem;
    }
    .archetype-modal-error {
      display: none;
      text-align: center;
      padding: 0.75rem 0;
      color: #ef4444;
      font-size: 0.875rem;
    }
    .archetype-table-wrapper { overflow-x: auto; }
    .archetype-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    .archetype-table th,
    .archetype-table td {
      text-align: left;
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid #2d3748;
    }
    .archetype-table th {
      color: #94a3b8;
      font-weight: 500;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .archetype-table tbody tr:hover { background: rgba(255,255,255,0.04); }
    .archetype-table .num { text-align: right; font-variant-numeric: tabular-nums; }
    .archetype-table .td-tourn {
      max-width: 190px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .archetype-deck-link { color: #60a5fa; text-decoration: none; font-size: 0.9rem; }
    .archetype-deck-link:hover { text-decoration: underline; }
  `;
    document.head.appendChild(style);
}

function getOrCreateArchetypeModal(): HTMLElement {
    const existing = document.getElementById(ARCHETYPE_MODAL_ID);
    if (existing) return existing;

    injectArchetypeStyles();

    const modal = document.createElement("div");
    modal.id = ARCHETYPE_MODAL_ID;
    modal.className = "archetype-modal-backdrop";
    modal.innerHTML = `
    <div class="archetype-modal-card">
      <div class="archetype-modal-header">
        <div class="archetype-modal-title-row">
          <span id="archetypeModalSwatch" class="archetype-modal-swatch"></span>
          <h4 id="archetypeModalTitle" class="archetype-modal-title"></h4>
        </div>
        <button id="archetypeModalClose" class="archetype-modal-close" aria-label="Close">✕</button>
      </div>
      <p id="archetypeModalMeta" class="archetype-modal-meta"></p>
      <div id="archetypeModalLoading" class="archetype-modal-loading">${t('Lade Daten…', 'Loading…')}</div>
      <div id="archetypeModalError" class="archetype-modal-error"></div>
      <div class="archetype-table-wrapper">
        <table class="archetype-table">
          <thead>
            <tr>
              <th>${t('Spieler', 'Player')}</th>
              <th>${t('Turnier', 'Tournament')}</th>
              <th class="num">W</th>
              <th class="num">L</th>
              <th class="num">D</th>
              <th class="num">Win%</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="archetypeModalTbody"></tbody>
        </table>
      </div>
    </div>
  `;
    document.body.appendChild(modal);

    (document.getElementById("archetypeModalClose") as HTMLButtonElement).onclick =
        () => { modal.style.display = "none"; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };

    return modal;
}

export async function openArchetypeModal(
    archetype: string,
    color: string,
    count: number,
    pctOfField: number,
    from?: string,
    to?: string,
    season?: string,
): Promise<void> {
    const modal = getOrCreateArchetypeModal();
    const titleEl = document.getElementById("archetypeModalTitle") as HTMLElement;
    const swatchEl = document.getElementById("archetypeModalSwatch") as HTMLElement;
    const metaEl = document.getElementById("archetypeModalMeta") as HTMLElement;
    const loadingEl = document.getElementById("archetypeModalLoading") as HTMLElement;
    const errorEl = document.getElementById("archetypeModalError") as HTMLElement;
    const tbody = document.getElementById("archetypeModalTbody") as HTMLElement;

    swatchEl.style.backgroundColor = color;
    titleEl.textContent = archetype;
    metaEl.textContent = `${count} appearances · ${pctOfField.toFixed(1)}% of field`;
    tbody.innerHTML = "";
    loadingEl.style.display = "block";
    errorEl.style.display = "none";
    errorEl.textContent = "";
    modal.style.display = "flex";

    try {
        const params = new URLSearchParams({ archetype });
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        if (season) params.set("season", season);

        const res = await fetch(`/api/archetype-players?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows: ArchetypePlayerRow[] = await res.json();

        loadingEl.style.display = "none";

        if (!rows.length) {
            errorEl.textContent = t('Keine Daten gefunden.', 'No data found.');
            errorEl.style.display = "block";
            return;
        }

        // Update meta with aggregate win rate
        const totalW = rows.reduce((s, r) => s + r.wins, 0);
        const totalG = rows.reduce((s, r) => s + r.wins + r.losses + r.draws, 0);
        const aggWR = totalG > 0 ? ((totalW / totalG) * 100).toFixed(1) : "—";
        metaEl.textContent = `${count} appearances · ${pctOfField.toFixed(1)}% of field · ${aggWR}% win rate`;

        for (const r of rows) {
            const wr = r.win_rate != null ? `${r.win_rate}%` : "—";
            const date = r.tournament_date
                ? r.tournament_date.slice(8, 10) + "." + r.tournament_date.slice(5, 7) + "." + r.tournament_date.slice(0, 4)
                : "";
            const link = r.decklist
                ? `<a href="${r.decklist}" target="_blank" rel="noopener" class="archetype-deck-link">↗</a>`
                : "";
            const tr = document.createElement("tr");
            tr.innerHTML = `
        <td>${r.player_name}</td>
        <td class="td-tourn" title="${r.tournament_name}">${r.tournament_name} <span style="color:#64748b;font-size:0.78rem">${date}</span></td>
        <td class="num">${r.wins}</td>
        <td class="num">${r.losses}</td>
        <td class="num">${r.draws}</td>
        <td class="num">${wr}</td>
        <td>${link}</td>
      `;
            tbody.appendChild(tr);
        }
    } catch (err) {
        loadingEl.style.display = "none";
        errorEl.textContent = `${t('Fehler', 'Error')}: ${err instanceof Error ? err.message : t('Unbekannt', 'Unknown')}`;
        errorEl.style.display = "block";
    }
}
