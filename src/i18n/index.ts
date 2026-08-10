export type Locale = 'de' | 'en';

const de = {
  nav: {
    home: 'Home',
    meta: 'Meta',
    standings: 'Standings',
  },
  common: {
    to: 'bis',
    unknown: 'Unbekannter Fehler',
  },
  index: {
    schedule: 'Jeden zweiten Mittwoch ab 18:30 Uhr',
    welcome:
      'Wir sind eine Gruppe von passionierten Pauper Spielern, die sich ' +
      'jeden Mittwoch im Vereinsheim von ' +
      '<a href="https://cbg.cologne" target="_blank" rel="noopener noreferrer">' +
      'Card &amp; Board Games Cologne e.V.' +
      '</a> in der Kölner Südstadt trifft um Pauper zu spielen. ' +
      'Je nach Teilnehmerzahl sind es kleinere Turniere mit mindestens drei Runden.' +
      '<br><br>' +
      'Für Vereinsmitglieder ist das Turnier frei, Nicht-Mitglieder werden um eine Spende von 4 Euro gebeten.' +
      '<br><br>' +
      'Wir freuen uns, wenn die Pauper Community weiter wächst und wir auch dich bei uns begrüßen dürfen!',
    card1: {
      header: 'Melee.gg Anmeldung',
      description:
        'Meldet euch per Melee.gg für unser Bi-Weekly im Vereinsheim von Card & Board Games Cologne an. Wir freuen uns auf euch!',
      button: 'Komm vorbei',
    },
    card2: {
      header: 'Meta & Standings',
      description: 'Hier findest du die aktuellen Meta- und Standings-Informationen für Pauper.',
      button: 'Zur Meta & Standings',
    },
  },
  map: {
    heading: 'Komm vorbei für die nächste Runde',
    register: 'Zur Anmeldung',
  },
  standings: {
    title: 'Tournament Standings (90 Tage)',
    error: 'Turniere konnten nicht geladen werden',
    back: '← Zurück zu den Turnieren',
    labels: {
      format: 'Format',
      players: 'Spieler',
      rounds: 'Runden',
      topCut: 'Top Cut',
      date: 'Datum',
    },
    table: {
      section: 'Spieler',
      rank: 'Rank',
      player: 'Spieler',
      archetype: 'Archetype',
      record: 'W-L-D',
      winPct: 'Win %',
      bracket: 'Bracket',
      decklist: 'Decklist',
    },
  },
  meta: {
    period: 'Zeitraum:',
    from: 'Von:',
    to: 'Bis:',
    season: 'Saison:',
    apply: 'Anwenden',
    allTournaments: 'Alle Turniere →',
    seasonView: '← Saison-Ansicht',
    dayLabels: { '30': '30 Tage', '90': '90 Tage', '180': '180 Tage', '365': '1 Jahr' },
    stats: {
      tournaments: 'Turniere',
      players: 'Spieler',
      avgParticipants: 'Ø Teilnehmer',
      totalEntries: 'Gesamt Einträge',
    },
    error: 'Daten konnten nicht geladen werden',
    empty: {
      period: 'Keine Daten für den gewählten Zeitraum vorhanden.',
      season: 'Keine Daten für diese Saison vorhanden.',
      retry: 'Die Datenbank wird täglich aktualisiert. Bitte versuche es später erneut.',
    },
    charts: {
      metaBreakdown: 'Meta Breakdown',
      playerRanking: 'Spieler Ranking',
      top8: 'Top 8 Spieler — Besten 8 Turniere',
      formatHealth: 'Format Health',
    },
  },
};

type Translations = typeof de;

const en: Translations = {
  nav: {
    home: 'Home',
    meta: 'Meta',
    standings: 'Standings',
  },
  common: {
    to: 'to',
    unknown: 'Unknown error',
  },
  index: {
    schedule: 'Every other Wednesday at 6:30 PM',
    welcome:
      'We are a group of passionate Pauper players who meet every Wednesday at the club venue of ' +
      '<a href="https://cbg.cologne" target="_blank" rel="noopener noreferrer">' +
      'Card &amp; Board Games Cologne e.V.' +
      "</a> in Cologne's Südstadt to play Pauper. " +
      'Depending on turnout, we run smaller tournaments with at least three rounds.' +
      '<br><br>' +
      'For club members the tournament is free; non-members are asked for a donation of €4.' +
      '<br><br>' +
      'We are happy to see the Pauper community grow and hope to welcome you among us!',
    card1: {
      header: 'Melee.gg Registration',
      description:
        'Register via Melee.gg for our Bi-Weekly at the Card & Board Games Cologne club venue. We look forward to seeing you!',
      button: 'Come visit',
    },
    card2: {
      header: 'Meta & Standings',
      description: 'Find the current meta and standings information for Pauper here.',
      button: 'Go to Meta & Standings',
    },
  },
  map: {
    heading: 'Come by for the next round',
    register: 'Sign Up',
  },
  standings: {
    title: 'Tournament Standings (90 Days)',
    error: 'Tournaments could not be loaded',
    back: '← Back to Tournaments',
    labels: {
      format: 'Format',
      players: 'Players',
      rounds: 'Rounds',
      topCut: 'Top Cut',
      date: 'Date',
    },
    table: {
      section: 'Players',
      rank: 'Rank',
      player: 'Player',
      archetype: 'Archetype',
      record: 'W-L-D',
      winPct: 'Win %',
      bracket: 'Bracket',
      decklist: 'Decklist',
    },
  },
  meta: {
    period: 'Period:',
    from: 'From:',
    to: 'To:',
    season: 'Season:',
    apply: 'Apply',
    allTournaments: 'All Tournaments →',
    seasonView: '← Season View',
    dayLabels: { '30': '30 Days', '90': '90 Days', '180': '180 Days', '365': '1 Year' },
    stats: {
      tournaments: 'Tournaments',
      players: 'Players',
      avgParticipants: 'Avg. Participants',
      totalEntries: 'Total Entries',
    },
    error: 'Data could not be loaded',
    empty: {
      period: 'No data available for the selected period.',
      season: 'No data available for this season.',
      retry: 'The database is updated daily. Please try again later.',
    },
    charts: {
      metaBreakdown: 'Meta Breakdown',
      playerRanking: 'Player Ranking',
      top8: 'Top 8 Players — Best 8 Tournaments',
      formatHealth: 'Format Health',
    },
  },
};

export function useTranslations(locale: Locale): Translations {
  return locale === 'en' ? en : de;
}
