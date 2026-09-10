// Jump-Out Schedule (page 50, upper half) — reads the monthly jump-outs workbook.
//
// Source: inputs/Jump Outs.xlsx — no header row, one row per line of the printed
// schedule, two months side by side:
//   A  first month date      B  first month venue
//   C or D  second month date (the export uses either)   E  second month venue
//
// Returns two month blocks, each split into the two sub-columns page 50 prints.

import { readSheet, excelDate } from './xlsx.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const dateOf = serial => {
  const n = Number(serial);
  return isFinite(n) && n > 0 ? new Date(Date.UTC(1899, 11, 30) + n * 86400000) : null;
};

// the export writes "Ballarat(Poly)" where the printed edition sets "Ballarat (Poly)"
const venue = v => String(v || '').replace(/\s+/g, ' ').replace(/(\S)\(/g, '$1 (').trim();

export async function loadJumpOuts(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('cannot read ' + url + ' (' + res.status + ')');
  const rows = await readSheet(await res.blob());
  const warnings = [];
  if (/[a-z]/i.test(rows[0] && rows[0].B || '') && /venue|date/i.test(Object.values(rows[0] || {}).join(' '))) {
    warnings.push('First row looks like a header — the export is expected to start at the first date.');
  }

  const pick = (rows, dateKeys, venueKey, label) => {
    const out = [];
    rows.forEach((r, i) => {
      const raw = dateKeys.map(k => r[k]).find(v => v !== undefined && String(v).trim() !== '');
      const v = venue(r[venueKey]);
      if (!raw && !v) return;
      if (!raw) { warnings.push(label + ': no date beside "' + v + '" (row ' + (i + 1) + ')'); return; }
      if (!v) { warnings.push(label + ': no venue beside ' + excelDate(raw) + ' (row ' + (i + 1) + ')'); return; }
      const d = dateOf(raw);
      if (!d) { warnings.push(label + ': "' + raw + '" is not a date (row ' + (i + 1) + ')'); return; }
      out.push({ date: excelDate(raw), venue: v, month: d.getUTCMonth(), year: d.getUTCFullYear(), at: d.getTime() });
    });
    return out;
  };

  const first = pick(rows, ['A'], 'B', 'First month');
  const second = pick(rows, ['C', 'D'], 'E', 'Second month');

  // A column is one month, in date order. The export is not always sorted, and
  // it sometimes carries a stray meeting from the month before, which the
  // printed schedule does not run: the column keeps the month most of its
  // entries fall in and reports the rest.
  const block = entries => {
    if (!entries.length) return null;
    const sorted = entries.slice().sort((a, b) => a.at - b.at);
    const tally = new Map();
    sorted.forEach(e => tally.set(e.month, (tally.get(e.month) || 0) + 1));
    const main = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const kept = sorted.filter(e => e.month === main);
    const dropped = sorted.filter(e => e.month !== main);
    if (dropped.length) {
      warnings.push('The ' + MONTHS[main] + ' column carries ' + dropped.length + ' entr'
        + (dropped.length > 1 ? 'ies' : 'y') + ' from another month, left out of the printed schedule: '
        + dropped.map(e => e.date + ' ' + e.venue).join(', ') + '.');
    }
    const half = Math.ceil(kept.length / 2);
    return {
      label: MONTHS[main] + ' ' + kept[0].year,
      count: kept.length,
      left: kept.slice(0, half),
      right: kept.slice(half)
    };
  };

  const blocks = [block(first), block(second)].filter(Boolean);
  if (!blocks.length) warnings.push('No jump-outs found in ' + url);
  return { blocks, warnings };
}
