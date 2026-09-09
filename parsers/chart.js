// Programs Summary Chart — reads the Victorian calendar workbook(s).
//
// The calendar arrives split by month, one workbook per month, named with a
// " - mmm yy" suffix:
//
//   inputs/Vic Calendar - Sep 26.xlsx
//   inputs/Vic Calendar - Oct 26.xlsx
//
// loadCharts() finds them, puts them in chronological order and reads them as
// one continuous chart, so the section flows across months in the order they
// race rather than the order the files happen to be named. A single unsuffixed
// inputs/Vic Calendar.xlsx still works on its own.
//
// Sheet layout, per workbook: sheet "Program Summary".
//   row 1        the fourteen column headings, A..N
//   rows 2 on    one meeting per row
//
// Cell formatting carries meaning in this chart — the venue name's colour marks
// metropolitan against country, and the meeting block mixes 6pt and 9pt type — so
// cells are read as rich-text runs rather than flattened to plain strings.

import { readSheetRich } from './xlsx.js';

const COLUMNS = 14; // A..N
const flat = runs => (runs || []).map(r => r.t).join('');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "SEPTEMBER EDITION 2026" -> { m: 8, y: 2026 }. Falls back to today. */
function editionMonth(edition) {
  const s = String(edition || '').toLowerCase();
  const m = MONTHS.findIndex(x => s.includes(x.toLowerCase()));
  const y = (s.match(/(20\d\d)/) || [])[1];
  const now = new Date();
  return { m: m < 0 ? now.getMonth() : m, y: y ? +y : now.getFullYear() };
}

const suffixName = (m, y) => 'Vic Calendar - ' + MONTHS[m] + ' ' + String(y).slice(2) + '.xlsx';

/**
 * Works out which calendar workbooks are present. Probes from one month before
 * the edition month through thirteen months after, which covers the forward
 * programming window without a directory listing.
 * Returns [{ url, label, m, y }] in chronological order.
 */
async function findCalendars(dir, edition) {
  const { m, y } = editionMonth(edition);
  const wanted = [];
  for (let k = -1; k <= 13; k++) {
    const d = new Date(Date.UTC(y, m + k, 1));
    wanted.push({ m: d.getUTCMonth(), y: d.getUTCFullYear() });
  }
  const found = [];
  await Promise.all(wanted.map(async w => {
    const name = suffixName(w.m, w.y);
    try {
      const res = await fetch(dir + name, { method: 'GET' });
      if (res.ok) found.push({ url: dir + name, label: name, m: w.m, y: w.y, blob: await res.blob() });
    } catch (e) { /* absent */ }
  }));
  found.sort((a, b) => a.y - b.y || a.m - b.m);
  return found;
}

/**
 * Reads every month's calendar and returns them joined, header from the first.
 * dir defaults to inputs/; edition is the Edition Settings string, used only to
 * decide which months to look for.
 */
export async function loadCharts(dir, edition) {
  const base = dir || 'inputs/';
  const files = await findCalendars(base, edition);
  const warnings = [];

  if (!files.length) {
    // no month-split files — fall back to the single workbook
    const single = await loadChart(base + 'Vic Calendar.xlsx');
    single.warnings.unshift('No month-split calendars found (expected e.g. "' + suffixName(editionMonth(edition).m, editionMonth(edition).y)
      + '") \u2014 read the single Vic Calendar.xlsx instead.');
    single.months = [];
    return single;
  }

  const parts = [];
  for (const f of files) parts.push({ f, data: await readChartBlob(f.blob, f.label) });

  const header = parts[0].data.header;
  const rows = [];
  const months = [];
  parts.forEach(({ f, data }) => {
    const shifted = data.warnings.map(w => f.label + ': ' + w);
    warnings.push(...shifted);
    if (data.header.join('|') !== header.join('|')) {
      warnings.push(f.label + ': column headings differ from ' + parts[0].f.label + ' \u2014 the chart columns may not line up.');
    }
    months.push({ label: f.label, month: MONTHS[f.m] + ' ' + f.y, count: data.rows.length });
    rows.push(...data.rows);
  });

  // a gap in the sequence usually means a month was forgotten
  for (let i = 1; i < files.length; i++) {
    const gap = (files[i].y - files[i - 1].y) * 12 + (files[i].m - files[i - 1].m);
    if (gap > 1) {
      warnings.push('Calendar months jump from ' + MONTHS[files[i - 1].m] + ' ' + files[i - 1].y
        + ' to ' + MONTHS[files[i].m] + ' ' + files[i].y + ' \u2014 ' + (gap - 1) + ' month(s) missing.');
    }
  }
  if (!rows.length) warnings.push('The calendar workbooks contain no meetings.');

  return { header, rows, warnings, count: rows.length, months };
}

export async function loadChart(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('cannot read ' + url + ' (' + res.status + ')');
  return readChartBlob(await res.blob(), url);
}

async function readChartBlob(blob, label) {
  const sheet = await readSheetRich(blob);
  const warnings = [];
  if (!sheet.length) return { header: [], rows: [], warnings: ['No rows found in ' + label], count: 0 };

  const letters = Array.from({ length: COLUMNS }, (_, i) => String.fromCharCode(65 + i));
  const header = letters.map(k => flat(sheet[0][k]));
  if (!/meeting details/i.test(header[0])) {
    warnings.push('First column heading is "' + header[0] + '", expected "Meeting Details" — the sheet layout may have changed.');
  }
  const blankHeads = header.map((h, i) => (h ? null : letters[i])).filter(Boolean);
  if (blankHeads.length) warnings.push('Blank column headings: ' + blankHeads.join(', '));

  const rows = sheet.slice(1)
    .filter(r => letters.some(k => flat(r[k]).trim()))
    .map((r, i) => {
      const cells = letters.map(k => r[k] || []);
      const meeting = flat(cells[0]);
      if (!meeting.trim()) warnings.push('Row ' + (i + 2) + ' has races but no meeting details.');
      else if (!(cells[0] || []).some(run => run.c)) {
        warnings.push('No venue colour on "' + meeting.split('\n')[1] + '" (row ' + (i + 2) + ') — metropolitan and country will look the same.');
      }
      if (cells.slice(1).every(c => !flat(c).trim())) {
        warnings.push('No races listed for "' + meeting.split('\n')[0] + '" (row ' + (i + 2) + ').');
      }
      return { cells };
    });

  if (rows.length < 15 || rows.length > 70) {
    warnings.push('Found ' + rows.length + ' meetings, expected between 15 and 70 for one month — check the export covers the full period.');
  }

  return { header, rows, warnings, count: rows.length };
}
