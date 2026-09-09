// Page 49 — Jumps Racing Program, Jumps Trials, Jumps Races Prizemoney Breakdowns.
//
// Three inputs, on three different rhythms:
//
//   inputs/Jumps Racing Program.xlsx        the whole season, replaced once a year
//   inputs/Jumps Trials.csv                 the trial races, per meeting
//   inputs/Jumps Prizemoney Breakdowns.csv  standing tiers, edited when they change
//
// The program workbook is one row per jumps meeting for the season, with five
// paired columns — description and prizemoney — for maiden hurdle, restricted
// hurdle, open hurdle, restricted steeplechase and open steeplechase. Only the
// edition month is printed.
//
// Two shapes in the sheet need handling. A meeting carrying two races of one
// class runs onto a second row with the date and venue cells merged, which
// arrives here as a row with no date and no venue: it belongs to the meeting
// above. And a row with a venue but no races at all is a trials or schooling
// day rather than a race meeting — it is kept out of the chart and checked
// against the trials file instead.

import { readSheet } from './xlsx.js';
import { fetchDelimited, rows as tsvRows } from './tsv.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];
const ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** The five class columns, in printed order, with their sheet columns. */
export const CLASSES = [
  { id: 'mh', label: 'Maiden Hurdle', desc: 'C', prize: 'D' },
  { id: 'rh', label: 'Restricted Hurdle', desc: 'E', prize: 'F' },
  { id: 'oh', label: 'Open Hurdle', desc: 'G', prize: 'H' },
  { id: 'rs', label: 'Restricted Steeplechase', desc: 'I', prize: 'J' },
  { id: 'os', label: 'Open Steeplechase', desc: 'K', prize: 'L' }
];

/** "AUGUST EDITION 2026" -> { month: 7, year: 2026, name: 'August' } */
export function editionMonth(edition) {
  const s = String(edition || '').toLowerCase();
  const month = MONTHS.findIndex(m => s.includes(m));
  const year = Number((s.match(/\b(20\d{2})\b/) || [])[1]);
  if (month < 0 || !year) return null;
  return { month, year, name: MONTHS[month][0].toUpperCase() + MONTHS[month].slice(1) };
}

/**
 * The date cell is typed by hand and comes in several shapes — "Sun 2 Aug 2026",
 * "Tues 5 May 2026", "Thu 26 February 2026", "Wednesday, 5 August 2026" — or
 * occasionally as an Excel serial. No weekday name shares its first three
 * letters with a month, so the month can be found anywhere in the string.
 */
function parseDate(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (/^\d{5}$/.test(v)) return new Date(Date.UTC(1899, 11, 30) + Number(v) * 86400000);
  const lower = v.toLowerCase();
  const day = Number((v.match(/\b(\d{1,2})\b/) || [])[1]);
  const year = Number((v.match(/\b(20\d{2})\b/) || [])[1]);
  const mi = MONTHS.findIndex(m => new RegExp('\\b' + m.slice(0, 3)).test(lower));
  if (!day || !year || mi < 0) return null;
  return new Date(Date.UTC(year, mi, day));
}

/** "SUN 2 AUG", as the chart sets it. */
function chartDate(d) {
  return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + ABBR[d.getUTCMonth()];
}

/** 35000 -> "$35,000". Left alone if it is not a plain number. */
function money(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const n = Number(raw.replace(/[$,]/g, ''));
  if (!isFinite(n) || !n) return raw;
  return '$' + n.toLocaleString('en-AU');
}

/**
 * Distances are written as a bare number in some cells and buried in a race
 * name in others. Print a metre mark on the first number that has not got one.
 */
function distance(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  if (/^\d{3,4}$/.test(raw)) return raw + 'm';
  return raw.replace(/\b(\d{3,4})\b(?!\s*m)/, '$1m').replace(/\s{2,}/g, ' ');
}

export async function loadJumpsProgram(url, edition) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('cannot read ' + url + ' (' + res.status + ')');
  const sheet = await readSheet(await res.blob());
  const warnings = [];
  const want = editionMonth(edition);
  if (!want) warnings.push('Jumps Program: could not read a month and year from the edition name "' + edition + '".');

  const head = sheet.findIndex(r => /^date$/i.test(String(r.A || '').trim()));
  if (head < 0) warnings.push('Jumps Program: no header row found — expected a row starting with "Date".');
  const body = sheet.slice(head + 1);

  const all = [];
  body.forEach((r, i) => {
    const line = 'row ' + (head + i + 2);
    const races = CLASSES.map(c => ({
      id: c.id,
      desc: distance(r[c.desc]),
      prize: money(r[c.prize])
    })).filter(x => x.desc || x.prize);

    const dateCell = String(r.A || '').trim();
    const venue = String(r.B || '').trim().replace(/\s{2,}/g, ' ');

    // A continuation of the meeting above: the date and venue cells are merged.
    if (!dateCell && !venue) {
      const prev = all[all.length - 1];
      if (!prev) { warnings.push('Jumps Program: a row with no date or venue at the top of the sheet — ' + line + '.'); return; }
      races.forEach(x => prev.cells[x.id].push({ desc: x.desc, prize: x.prize }));
      return;
    }

    const d = parseDate(dateCell);
    if (!d) { warnings.push('Jumps Program: cannot read the date "' + dateCell + '" — ' + line + '.'); return; }
    if (!venue) warnings.push('Jumps Program: no meeting name — ' + line + '.');

    const cells = {};
    CLASSES.forEach(c => { cells[c.id] = []; });
    races.forEach(x => cells[x.id].push({ desc: x.desc, prize: x.prize }));

    all.push({ date: d, dateLabel: chartDate(d), venue, cells, races: races.length, line });
  });

  // A season workbook holding a date from another year is a typo, not a horizon.
  if (want) {
    const strays = all.filter(m => m.date.getUTCFullYear() !== want.year);
    if (strays.length) {
      warnings.push('Jumps Program: ' + strays.length + ' meeting' + (strays.length > 1 ? 's are' : ' is')
        + ' dated ' + [...new Set(strays.map(m => m.date.getUTCFullYear()))].join(' and ')
        + ' in a ' + want.year + ' program — ' + strays.map(m => m.venue + ', ' + m.line).join('; ') + '.');
    }
  }

  const inMonth = want
    ? all.filter(m => m.date.getUTCMonth() === want.month && m.date.getUTCFullYear() === want.year)
    : [];
  const meetings = inMonth.filter(m => m.races > 0);
  const trialDays = inMonth.filter(m => m.races === 0);

  if (want && !meetings.length) {
    warnings.push('Jumps Program: no jumps meetings carrying races in ' + want.name + ' ' + want.year
      + ' — check the workbook covers this month, or set jumps_included to No.');
  }
  meetings.forEach(m => {
    CLASSES.forEach(c => {
      m.cells[c.id].forEach(e => {
        if (e.desc && !e.prize) warnings.push('Jumps Program: ' + c.label + ' at ' + m.venue + ' has a race but no prizemoney — ' + m.line + '.');
        if (!e.desc && e.prize) warnings.push('Jumps Program: ' + c.label + ' at ' + m.venue + ' has prizemoney but no race — ' + m.line + '.');
      });
    });
  });

  return { meetings, trialDays, warnings, month: want };
}

export async function loadJumpsTrials(url, trialDays, want) {
  const { text } = await fetchDelimited(url);
  const { head, body } = tsvRows(text);
  const warnings = [];
  const need = ['Meeting', 'Date', 'Race', 'Name', 'Type', 'Distance'];
  need.forEach(h => { if (!head.includes(h)) warnings.push('Jumps Trials: no "' + h + '" column — header reads ' + head.join(' | ') + '.'); });

  // The file holds whatever has been entered; only the edition month prints.
  let rows = body;
  if (want) {
    const other = [];
    rows = body.filter((r, i) => {
      const d = parseDate(r.Date);
      if (!d) {
        if ((r.Meeting || '').trim()) warnings.push('Jumps Trials: cannot read the date "' + r.Date + '" — row ' + (i + 2) + '.');
        return false;
      }
      const hit = d.getUTCMonth() === want.month && d.getUTCFullYear() === want.year;
      if (!hit) other.push(r.Meeting);
      return hit;
    });
    if (other.length) {
      warnings.push('Jumps Trials: ' + other.length + ' race' + (other.length > 1 ? 's are' : ' is')
        + ' outside ' + want.name + ' ' + want.year + ' and not printed ('
        + [...new Set(other)].join(', ') + ').');
    }
  }

  const byMeeting = new Map();
  rows.forEach((r, i) => {
    const line = 'row ' + (i + 2);
    const key = r.Meeting + '\u0000' + r.Date;
    if (!r.Meeting) { warnings.push('Jumps Trials: no meeting name — ' + line + '.'); return; }
    if (!r.Name) warnings.push('Jumps Trials: no race name — ' + line + '.');
    if (!r.Distance) warnings.push('Jumps Trials: no distance — ' + line + '.');
    if (!byMeeting.has(key)) byMeeting.set(key, { venue: r.Meeting, date: r.Date, races: [] });
    byMeeting.get(key).races.push({
      no: r.Race,
      title: (r.Race ? r.Race + '. ' : '') + r.Name,
      cond: r.Type,
      dist: r.Distance
    });
  });
  const meetings = [...byMeeting.values()];

  // The program workbook lists a trials day with no races against it. If one of
  // those has no races in this file, the block will print an empty column.
  (trialDays || []).forEach(d => {
    const venue = d.venue.replace(/\s*trials?\s*/ig, ' ').trim().toLowerCase();
    const hit = meetings.some(m => m.venue.toLowerCase().includes(venue.split(/\s+/)[0]));
    if (!hit) {
      warnings.push('Jumps Trials: the program has a trials day at ' + d.venue + ' on ' + d.dateLabel
        + ' but no trial races are listed for it.');
    }
  });
  if (meetings.length > 4) {
    warnings.push('Jumps Trials: ' + meetings.length + ' trial meetings — page 49 sets four columns, so the rest will not fit.');
  }
  return { meetings, warnings };
}

export async function loadJumpsBreakdowns(url) {
  const { text } = await fetchDelimited(url);
  const { head, body } = tsvRows(text);
  const warnings = [];
  if (!head.includes('Amount') || !head.includes('Breakdown')) {
    warnings.push('Jumps Prizemoney Breakdowns: header reads ' + head.join(' | ') + ', expected Amount | Breakdown.');
  }
  const tiers = body.filter(r => (r.Amount || '').trim()).map((r, i) => {
    if (!r.Breakdown) warnings.push('Jumps Prizemoney Breakdowns: "' + r.Amount + '" has no breakdown — row ' + (i + 2) + '.');
    return { amount: r.Amount.trim(), breakdown: (r.Breakdown || '').trim() };
  });
  if (!tiers.length) warnings.push('Jumps Prizemoney Breakdowns: no tiers found.');
  return { tiers, warnings };
}

/**
 * The whole page in one call, for the assembled edition: the three files read
 * together and their warnings collected, so the caller has a single entry in
 * its load. The trials cross-check needs the program's trial days, so that one
 * waits; the breakdowns do not.
 */
export async function loadJumps(dir, edition) {
  const at = f => (dir || 'inputs/') + f;
  const [prog, tiersRes] = await Promise.all([
    loadJumpsProgram(at('Jumps Racing Program.xlsx'), edition)
      .catch(e => ({ meetings: [], trialDays: [], warnings: ['Jumps Program: ' + (e.message || e)] })),
    loadJumpsBreakdowns(at('Jumps Prizemoney Breakdowns.csv'))
      .catch(e => ({ tiers: [], warnings: ['Jumps Prizemoney Breakdowns: ' + (e.message || e)] }))
  ]);
  const trials = await loadJumpsTrials(at('Jumps Trials.csv'), prog.trialDays, prog.month)
    .catch(e => ({ meetings: [], warnings: ['Jumps Trials: ' + (e.message || e)] }));

  // Page 49 holds one chart band, four trial columns and eight tiers. The three
  // blocks flow, so a busier month pushes the sections below it down rather
  // than printing on top of them — but it can still push the last block off the
  // page, which nothing downstream would notice. Say so while there is time.
  const capacity = [];
  const meetings = prog.meetings || [];
  const trialCols = (trials.meetings || []).reduce((n, t) => n + Math.ceil(t.races.length / 4), 0);
  if (meetings.length > 7) {
    capacity.push('Jumps Program: ' + meetings.length + ' meetings in the month. Page 49 holds about seven'
      + ' before the Off The Track panel is pushed off the foot of the page — the section needs a second page.');
  }
  if (trialCols > 4) {
    capacity.push('Jumps Trials: the races fill ' + trialCols + ' columns against the four page 49 sets'
      + ' — ' + (trialCols - 4) + ' will not print. Reduce the races listed, or the section needs a second page.');
  }
  return {
    meetings: prog.meetings || [],
    trials: trials.meetings || [],
    tiers: tiersRes.tiers || [],
    count: (prog.meetings || []).length,
    warnings: (prog.warnings || []).concat(trials.warnings || [], tiersRes.warnings || [],
      checkTiers(prog.meetings || [], tiersRes.tiers || []), capacity)
  };
}

/**
 * Every prizemoney figure printed in the chart should have a tier explaining
 * how it splits. Reported rather than fixed — a missing tier is a content
 * decision, not a parse error.
 */
export function checkTiers(meetings, tiers) {
  const have = new Set(tiers.map(t => t.amount.replace(/[^\d]/g, '')));
  const missing = new Set();
  meetings.forEach(m => Object.values(m.cells).forEach(list => list.forEach(e => {
    const n = String(e.prize || '').replace(/[^\d]/g, '');
    if (n && !have.has(n)) missing.add(e.prize);
  })));
  return missing.size
    ? ['Jumps Prizemoney Breakdowns: no tier for ' + [...missing].join(', ')
       + ' — the chart prints ' + (missing.size > 1 ? 'those figures' : 'that figure') + ' with nothing explaining the split.']
    : [];
}
