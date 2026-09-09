// Official Flat Trials (page 50, lower half) — reads the trials export and groups
// it into one column per trial meeting.
//
// Source: inputs/Official Flat Trials.csv or .xlsx — the same schema as the race
// programs export, so it is read by column position either way. Columns used:
//   D meet_date            e.g. "Tuesday, 18 August 2026"
//   E meet_day_venue_name  e.g. "Bendigo"
//   G race_number          J race_distance     K race_conditions
//   H name_race_full
//
// Page 50 sets four columns across, so more than four meetings will not fit.

import { readSheet } from './xlsx.js';
import { fetchDelimited, letterRows } from './tsv.js';

const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
// Page 50 sets four columns across; more trials than that run onto a further
// page rather than being dropped.
const MAX_COLUMNS = 4;

export async function loadTrials(url) {
  let rows;
  if (/\.(csv|tsv|txt)$/i.test(url)) {
    const { text } = await fetchDelimited(url);
    rows = letterRows(text);
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error('cannot read ' + url + ' (' + res.status + ')');
    rows = await readSheet(await res.blob());
  }
  const warnings = [];

  const head = rows[0] || {};
  if (clean(head.E).toLowerCase() !== 'meet_day_venue_name' || clean(head.K).toLowerCase() !== 'race_conditions') {
    warnings.push('Header row is not the expected export schema — columns may have moved. Found E="' + clean(head.E) + '", K="' + clean(head.K) + '"');
  }

  const meetings = [];
  let current = null;
  rows.slice(1).forEach((r, i) => {
    const line = 'row ' + (i + 2);
    const venue = clean(r.E);
    const date = clean(r.D);
    const no = clean(r.G);
    const title = clean(r.H);
    if (!venue && !no && !title) return;      // a blank row in the export
    if (venue) {
      current = { venue: venue.toUpperCase(), date: date.toUpperCase(), races: [] };
      meetings.push(current);
      if (!date) warnings.push('No meeting date for ' + venue + ' — ' + line);
    }
    if (!current) { warnings.push('Race before any meeting heading — ' + line); return; }
    if (!no) warnings.push('No race number — ' + line);
    if (!title) warnings.push('No race name — ' + line);
    if (!clean(r.J)) warnings.push('No distance — ' + line);
    if (!clean(r.K)) warnings.push('No conditions — ' + line);
    current.races.push({
      no: no,
      title: no ? no + '. ' + title.toUpperCase() : title.toUpperCase(),
      cond: clean(r.K),
      dist: clean(r.J)
    });
  });

  meetings.forEach(m => {
    if (!m.races.length) warnings.push(m.venue + ' has no races.');
    if (m.races.length > 9) warnings.push(m.venue + ' has ' + m.races.length + ' races \u2014 a trial column holds about 9, so this one will run deep.');
  });
  const pages = Math.max(1, Math.ceil(meetings.length / MAX_COLUMNS));
  if (pages > 1) {
    warnings.push(meetings.length + ' trial meetings \u2014 four to a row, so the trials run to ' + pages + ' pages.');
  }
  if (!meetings.length) warnings.push('No trial meetings found in ' + url);

  return { meetings, warnings, pages };
}
