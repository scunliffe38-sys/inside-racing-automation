// Picnic Racing — the programs table for the picnic meetings ahead.
//
//   inputs/Picnic Program.xlsx   one worksheet per season, replaced yearly
//
// The printed section covers everything the workbook still holds from the
// edition month onwards, not a fixed horizon, so it runs to as many pages as
// that takes. Passing a month count narrows it to that many months.
//
// Sheet shape, per season:
//
//   row 1        the title
//   row 2        the standing "programs are subject to change" note
//   row 3        group headings — Maiden (C:D), Restricted Trophy (E:G), Open (H:J)
//   row 4        sub headings — 1, 2, 3 and the three Open distance bands
//   rows 5+      one meeting per row: A date, B venue, C-J the races
//   last rows    the (QC) eligibility notes
//
// A meeting offering two or three races of one kind runs onto further rows with
// the date and venue merged, which arrives here as a row with no date and no
// venue: it belongs to the meeting above. The printed cell divides equally
// between them, as the summary chart does.

import { readSheets } from './xlsx.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];
const ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const TITLE = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The nine printed columns, in order, with the sheet column each reads. */
export const COLUMNS = [
  { id: 'date', label: '', group: '', col: 'A' },
  { id: 'm1', label: '', group: 'Maiden', col: 'C' },
  { id: 'm2', label: '', group: 'Maiden', col: 'D' },
  { id: 'rt1', label: '1', group: 'Restricted Trophy', col: 'E' },
  { id: 'rt2', label: '2', group: 'Restricted Trophy', col: 'F' },
  { id: 'rt3', label: '3', group: 'Restricted Trophy', col: 'G' },
  { id: 'o1', label: '999m - 1499m', group: 'Open', col: 'H' },
  { id: 'o2', label: '1500m - 1999m', group: 'Open', col: 'I' },
  { id: 'o3', label: '2000m - 3000m', group: 'Open', col: 'J' }
];

const RACE_COLS = COLUMNS.filter(c => c.col !== 'A');

/** "AUGUST EDITION 2026" -> { month: 7, year: 2026 } */
export function editionMonth(edition) {
  const s = String(edition || '').toLowerCase();
  const month = MONTHS.findIndex(m => s.includes(m));
  const year = Number((s.match(/\b(20\d{2})\b/) || [])[1]);
  return month < 0 || !year ? null : { month, year };
}

function parseDate(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (/^\d{5}(\.\d+)?$/.test(v)) return new Date(Date.UTC(1899, 11, 30) + Math.round(Number(v)) * 86400000);
  const lower = v.toLowerCase();
  const day = Number((v.match(/\b(\d{1,2})\b/) || [])[1]);
  const year = Number((v.match(/\b(20\d{2})\b/) || [])[1]);
  const mi = MONTHS.findIndex(m => new RegExp('\\b' + m.slice(0, 3)).test(lower));
  return day && year && mi >= 0 ? new Date(Date.UTC(year, mi, day)) : null;
}

/** "18-OCT-25", as the first column sets it. */
function dateLabel(d) {
  return d.getUTCDate() + '-' + ABBR[d.getUTCMonth()] + '-' + String(d.getUTCFullYear()).slice(2);
}

/**
 * The sheet writes prizemoney with a dollar sign and spaces around the rating
 * band; the page prints the dollar sign and closes the band up. The sign is
 * stripped and reapplied so a cell typed without one still prints with one.
 */
function cell(raw) {
  const t = String(raw || '')
    .replace(/\$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(\d)\s*-\s*(\d)/g, '$1-$2')
    .trim();
  return t.replace(/^(\d[\d,]*)/, '$$$1');
}

/** Anything that does not look like "5,000 1200m" is worth a second look. */
function suspect(text) {
  if (!text) return null;
  text = String(text).replace(/\$/g, '');
  if (/^,|,\s*\d{4}/.test(text) && !/^\d{1,3}(,\d{3})/.test(text)) return 'the prizemoney reads "' + text + '"';
  if (/\d+m\s+\d+m/.test(text)) return 'two distances in one entry: "' + text + '"';
  if (/\)\)/.test(text)) return 'a doubled bracket: "' + text + '"';
  if (!/\d/.test(text)) return 'no figures: "' + text + '"';
  if (!/\d+\s*m\b/.test(text)) return 'no distance: "' + text + '"';
  return null;
}

export async function loadPicnics(url, edition, months) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('cannot read ' + url + ' (' + res.status + ')');
  const sheets = await readSheets(await res.blob());
  const warnings = [];
  const want = editionMonth(edition);
  if (!want) warnings.push('Picnic Program: could not read a month and year from the edition name "' + edition + '".');

  const span = Number(months) > 0 ? Number(months) : 0;
  const from = want ? Date.UTC(want.year, want.month, 1) : 0;
  const to = want && span ? Date.UTC(want.year, want.month + span, 1) : Infinity;

  const all = [];
  const notes = [];
  const seenNote = new Set();
  sheets.forEach(sheet => {
    const where = sheet.name;
    // the group and sub headings sit above the meetings; everything at or
    // before them is furniture, not data
    const headRow = (sheet.rows.find(r => /^maiden$/i.test(String(r.C || '').trim())) || {}).__row || 0;
    let last = null;
    sheet.rows.forEach(r => {
      const rowNo = r.__row;
      if (headRow && rowNo <= headRow + 1) {
        const note = String(r.A || '').trim();
        if (note && /^programs are subject/i.test(note) && !seenNote.has(note)) { seenNote.add(note); notes.push(note); }
        return;
      }
      const dateCell = String(r.A || '').trim();
      const venue = String(r.B || '').trim().replace(/\s+/g, ' ');
      const races = {};
      let any = false;
      RACE_COLS.forEach(c => {
        const t = cell(r[c.col]);
        races[c.id] = t ? [t] : [];
        if (t) any = true;
      });

      // the notes at the foot of the sheet, and the standing note in row 2
      if (!any && dateCell && !parseDate(dateCell) && !venue) {
        if (/^programs are subject|^\(qc\)|^eligibility|^\d\.\s|^\*/i.test(dateCell) && !seenNote.has(dateCell)) {
          seenNote.add(dateCell);
          notes.push(dateCell);
        }
        return;
      }
      // a continuation of the meeting above: date and venue are merged away
      if (!dateCell && !venue) {
        if (!any) return;
        if (!last) { warnings.push('Picnic Program (' + where + '): races with no meeting above them — row ' + rowNo + '.'); return; }
        RACE_COLS.forEach(c => { races[c.id].forEach(t => last.cells[c.id].push(t)); });
        return;
      }

      const d = parseDate(dateCell);
      if (!d) {
        if (any) warnings.push('Picnic Program (' + where + '): cannot read the date "' + dateCell + '" — row ' + rowNo + '.');
        return;
      }
      if (!venue) warnings.push('Picnic Program (' + where + '): no venue — row ' + rowNo + '.');
      const cells = {};
      RACE_COLS.forEach(c => { cells[c.id] = races[c.id].slice(); });
      last = { date: d, dateLabel: dateLabel(d), iso: d.toISOString().slice(0, 10), venue, cells, sheet: where, row: rowNo };
      all.push(last);
    });
  });

  all.sort((a, b) => a.date - b.date);
  const meetings = want ? all.filter(m => m.date >= from && m.date < to) : [];

  meetings.forEach(m => {
    let races = 0;
    RACE_COLS.forEach(c => {
      m.cells[c.id].forEach(t => {
        races++;
        const bad = suspect(t);
        if (bad) warnings.push('Picnic Program (' + m.sheet + '): ' + m.venue + ' ' + m.dateLabel + ' — ' + bad + ', row ' + m.row + '.');
      });
    });
    if (!races) warnings.push('Picnic Program (' + m.sheet + '): ' + m.venue + ' ' + m.dateLabel + ' has no races — row ' + m.row + '.');
  });

  if (want && !meetings.length) {
    warnings.push('Picnic Program: no picnic meetings from ' + TITLE[want.month] + ' ' + want.year
      + ' onwards — check the workbook covers the season, or set picnics_included to No.');
  }
  if (!notes.length) warnings.push('Picnic Program: no eligibility notes found at the foot of the sheet.');

  // "Oct-Jan", from the months actually printed
  const range = meetings.length
    ? TITLE[meetings[0].date.getUTCMonth()] + '-' + TITLE[meetings[meetings.length - 1].date.getUTCMonth()]
    : '';

  return { meetings, notes, range, count: meetings.length, warnings };
}
