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
        <button id="playerDeckModalClose" class="deck-modal-close" aria-label="Schlie\u00dfen">\u2715</button>
      </div>
      <div id="playerDeckLoading" class="deck-modal-loading">Lade Daten\u2026</div>
      <div id="playerDeckError" class="deck-modal-error"></div>
      <div id="playerDeckChartContainer" class="deck-chart-inner">
        <canvas id="playerDeckChartCanvas"></canvas>
      </div>
      <div class="deck-table-wrapper">
        <table class="deck-table">
          <thead>
            <tr>
              <th>Deck</th>
              <th>Bilanz</th>
              <th>Win Rate</th>
              <th>Turniere</th>
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

    const filterLabel = season ?? (days ? `${days} Tage` : "");
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

        const res = await fetch(`/api/player-deck-stats?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: DeckStat[] = await res.json();

        loadingEl.style.display = "none";

        if (!data.length) {
            errorEl.textContent = "Keine Deck-Daten f\u00fcr diesen Spieler.";
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
        errorEl.textContent = `Fehler: ${err instanceof Error ? err.message : "Unbekannt"}`;
        errorEl.style.display = "block";
    }
}
