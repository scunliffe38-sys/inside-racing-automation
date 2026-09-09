// Entry Deadlines (pages 2-5) — reads the deadlines export.
//
// Source: inputs/Entry Deadlines.csv — tab separated, UTF-16, one row per day.
//   date_order  the calendar date, e.g. 01/09/2026
//   date        the printed day heading, e.g. "Tuesday, 1 September"
// then five header/value pairs, printed in this order when they carry anything:
//   feature_race_entry, feature_race_acceptance, entries, acceptances, riders
// Several deadlines in one cell are separated by the export's \sYYY\s marker.

import { fetchDelimited, rows, splitLines } from './tsv.js';

const GROUPS = [
  ['feature_race_entry_header', 'feature_race_entry'],
  ['feature_race_acceptance_header', 'feature_race_acceptance'],
  ['entries_header', 'entries'],
  ['acceptances_header', 'acceptances'],
  ['riders_header', 'riders']
];

export async function loadDeadlines(url) {
  const { text } = await fetchDelimited(url);
  const { head, body } = rows(text);
  const warnings = [];

  const missing = ['date_order', 'date'].concat(GROUPS.map(g => g[1])).filter(c => !head.includes(c));
  if (missing.length) warnings.push('Export is missing expected columns: ' + missing.join(', '));

  const days = body.map((r, i) => {
    const line = 'row ' + (i + 2);
    const groups = [];
    GROUPS.forEach(([hk, vk]) => {
      const items = splitLines(r[vk]);
      if (!items.length) return;
      const header = (r[hk] || '').trim();
      if (!header) warnings.push('Deadlines listed with no heading in ' + vk + ' — ' + line);
      groups.push({ header: header || vk.replace(/_/g, ' ').toUpperCase(), items });
    });
    if (!r.date) warnings.push('No day heading — ' + line);
    if (!groups.length) warnings.push('No deadlines at all on ' + (r.date || line));
    return { date: r.date_order || '', day: (r.date || '').toUpperCase(), groups };
  });

  // the printed section runs day by day and can span two or three months
  const dates = days.map(d => d.date).filter(Boolean);
  const dup = dates.filter((d, i) => dates.indexOf(d) !== i);
  if (dup.length) warnings.push('Duplicate dates: ' + [...new Set(dup)].join(', '));
  if (days.length < 25 || days.length > 120) {
    warnings.push('Found ' + days.length + ' days, expected between 25 and 120 rows.');
  }

  return { days, warnings, count: days.length };
}
