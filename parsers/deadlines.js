// Entry Deadlines (pages 3-6) — reads the deadlines export, then applies the
// two sheets the team keeps by hand.
//
// Source: inputs/Entry Deadlines.csv — tab separated, UTF-16, one row per day.
//   date_order  the calendar date, e.g. 01/09/2026
//   date        the printed day heading, e.g. "Tuesday, 1 September"
// then five header/value pairs, printed in this order when they carry anything:
//   feature_race_entry, feature_race_acceptance, entries, acceptances, riders
// Several deadlines in one cell are separated by the export's \sYYY\s marker.
//
// Two adjustments follow, because the export is a mechanical six-days-out
// calculation and the printed edition is not:
//
//   inputs/Feature Race Deadlines - Entry Deadlines.xlsx
//     Date | Race | Stage | Time | Meeting date
//     The real feature race schedule, which runs through late entries and
//     staged acceptances the program file has no way of knowing. Where this
//     sheet has rows, they REPLACE every feature race line the export
//     produced — the export's single entry and single acceptance per feature
//     are the thing being corrected. A date the export never listed is added
//     as a day of its own, which is how the Melbourne Cup's final acceptance
//     reaches 31 October.
//
//   inputs/Meeting Corrections - Entry Deadlines.xlsx
//     Date | Heading | Meeting as supplied | Print as | Time
//     For the ordinary Entries / Acceptances / Riders lines: a venue that
//     prints without its sponsor, or a time the export has wrong.
//
// Both are optional. A folder without them prints the export as it stands.

import { fetchDelimited, rows, splitLines } from './tsv.js';
import { readSheet } from './xlsx.js';

const GROUPS = [
  ['feature_race_entry_header', 'feature_race_entry'],
  ['feature_race_acceptance_header', 'feature_race_acceptance'],
  ['entries_header', 'entries'],
  ['acceptances_header', 'acceptances'],
  ['riders_header', 'riders']
];

const FEATURES_FILE = 'inputs/Feature Race Deadlines - Entry Deadlines.xlsx';
const CORRECTIONS_FILE = 'inputs/Meeting Corrections - Entry Deadlines.xlsx';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The stages print latest-first, the way the published edition sets them:
// a final acceptance above a third, and a second late entry above an entry.
const STAGES = ['final acceptance', '3rd acceptance', '2nd acceptance', 'acceptance',
  '2nd late entry', 'late entry', 'entry'];

const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/** Excel keeps a typed date as a serial; the team may also type it as text. */
function cellDate(v) {
  const s = clean(v);
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 20000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
  }
  const m = s.match(/^(\d{1,2})[ \-/]+([A-Za-z]+)\.?(?:[ \-/]+(\d{2,4}))?$/);
  if (m) {
    const mi = MONTHS.findIndex(x => x.startsWith(m[2].toLowerCase().slice(0, 3)));
    if (mi < 0) return null;
    let y = m[3] ? Number(m[3]) : null;
    if (y != null && y < 100) y += 2000;
    return { y, m: mi, d: Number(m[1]) };
  }
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (dmy) {
    let y = Number(dmy[3]); if (y < 100) y += 2000;
    return { y, m: Number(dmy[2]) - 1, d: Number(dmy[1]) };
  }
  return null;
}

const keyOf = p => p ? (p.y == null ? 'x' : p.y) + '-' + String(p.m + 1).padStart(2, '0') + '-' + String(p.d).padStart(2, '0') : '';

/**
 * A day from the export. Its `date_order` column is month-first (8/3/2026 is
 * 3 August), so the printed heading — "Monday, 3 August" — is what the date is
 * read from, with the year taken off the numeric column.
 */
function dayParts(d) {
  const y = (String(d.date || '').match(/(\d{4})\s*$/) || [])[1];
  const m = String(d.day || '').match(/(\d{1,2})\s+([A-Za-z]+)/);
  if (m) {
    const mi = MONTHS.findIndex(x => x.startsWith(m[2].toLowerCase().slice(0, 3)));
    if (mi >= 0) return { y: y ? Number(y) : null, m: mi, d: Number(m[1]) };
  }
  const us = String(d.date || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    let yy = Number(us[3]); if (yy < 100) yy += 2000;
    return { y: yy, m: Number(us[1]) - 1, d: Number(us[2]) };
  }
  return cellDate(d.date);
}
const dayKey = d => keyOf(dayParts(d));
/** "10 October", as the bracket after a time is set. */
const dayMonth = p => p ? p.d + ' ' + MONTHS[p.m].replace(/^./, c => c.toUpperCase()) : '';

/** A date cell that may already be printable text ("10 October"). */
function printableDate(v) {
  const s = clean(v);
  if (!s) return '';
  const p = cellDate(s);
  return p ? dayMonth(p) : s;
}

/** Sheet rows as objects, header row dropped, blank rows skipped. */
function sheetRows(raw, cols) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const out = [];
  raw.forEach((r, i) => {
    const vals = letters.map(l => clean(r[l]));
    if (i === 0 && vals[0] && /^date$/i.test(vals[0])) return;   // header
    if (!vals.some(Boolean)) return;
    if (vals[0].charAt(0) === '#') return;                        // a note row
    const o = {};
    cols.forEach((name, j) => { o[name] = vals[j] || ''; });
    o.__raw = r;
    out.push(o);
  });
  return out;
}

async function maybeSheet(url) {
  let res;
  try { res = await fetch(url); } catch (e) { return null; }
  if (!res || !res.ok) return null;
  return readSheet(await res.blob());
}

/** The feature race schedule the team keeps. */
export async function loadFeatureDeadlines(url) {
  const raw = await maybeSheet(url || FEATURES_FILE);
  if (!raw) return { rows: [], warnings: [], present: false };
  const warnings = [];
  const list = sheetRows(raw, ['date', 'race', 'stage', 'time', 'meeting']).map((r, i) => {
    const line = 'row ' + (i + 2);
    const at = cellDate(r.date);
    if (!at) warnings.push('Feature race deadlines: cannot read the date "' + r.date + '" — ' + line);
    if (!r.race) warnings.push('Feature race deadlines: no race name — ' + line);
    if (!r.time) warnings.push('Feature race deadlines: no time for ' + (r.race || line));
    const stage = r.stage || 'Entry';
    if (!STAGES.includes(stage.toLowerCase())) {
      warnings.push('Feature race deadlines: "' + stage + '" is not a stage I know for '
        + (r.race || line) + '. Use ' + STAGES.join(', ') + '.');
    }
    return { at, key: keyOf(at), race: r.race, stage, time: r.time, meeting: printableDate(r.meeting) };
  }).filter(r => r.at && r.race);
  return { rows: list, warnings, present: true };
}

/** Corrections to the ordinary entries, acceptances and riders lines. */
export async function loadMeetingCorrections(url) {
  const raw = await maybeSheet(url || CORRECTIONS_FILE);
  if (!raw) return { rows: [], warnings: [], present: false };
  const warnings = [];
  const list = sheetRows(raw, ['date', 'heading', 'supplied', 'printAs', 'time']).map((r, i) => {
    const line = 'row ' + (i + 2);
    const at = cellDate(r.date);
    if (!at) warnings.push('Meeting corrections: cannot read the date "' + r.date + '" — ' + line);
    if (!r.supplied) warnings.push('Meeting corrections: no meeting to match — ' + line);
    if (!r.printAs && !r.time) warnings.push('Meeting corrections: nothing to change for ' + (r.supplied || line));
    return { at, key: keyOf(at), heading: r.heading, supplied: r.supplied, printAs: r.printAs, time: r.time };
  }).filter(r => r.at && r.supplied);
  return { rows: list, warnings, present: true };
}

const isFeatureGroup = g => /^feature/i.test(g.key || '') || /^FEATURE/i.test(g.header || '');
const headingKey = h => clean(h).toLowerCase().replace(/[^a-z]/g, '');

/**
 * Puts the two sheets over the parsed days. Returns the days it was handed,
 * with the feature groups rebuilt and the corrections applied, plus what it
 * did and what it could not find.
 */
export function applyAdjustments(days, features, corrections) {
  const warnings = [];
  const byKey = new Map();
  days.forEach(d => byKey.set(dayKey(d), d));
  let featureLines = 0, applied = 0;

  if (features && features.length) {
    // The sheet is the whole feature schedule, so the export's own feature
    // lines go first — otherwise a race prints twice, once on the real date
    // and once six days out.
    days.forEach(d => { d.groups = d.groups.filter(g => !isFeatureGroup(g)); });
    const byDate = new Map();
    features.forEach(f => {
      if (!byDate.has(f.key)) byDate.set(f.key, []);
      byDate.get(f.key).push(f);
    });
    const absent = [...byDate.keys()].filter(k => !byKey.has(k));
    // A sheet left over from another month shows up as every date missing,
    // which is worth saying once rather than eleven times.
    const strays = absent.length === byDate.size && byDate.size > 2;
    if (strays) {
      warnings.push('Feature race deadlines: not one of the ' + byDate.size
        + ' dates in the sheet is in the export. The sheet looks like it belongs to another month — check it against inputs/Entry Deadlines.csv.');
    }
    for (const [key, list] of byDate) {
      let day = byKey.get(key);
      if (!day) {
        const at = list[0].at;
        const when = at.y == null ? null : new Date(Date.UTC(at.y, at.m, at.d));
        day = {
          date: at.y == null ? '' : (at.m + 1) + '/' + at.d + '/' + at.y,
          day: ((when ? DOW[when.getUTCDay()] + ', ' : '') + dayMonth(at)).toUpperCase(),
          groups: []
        };
        days.push(day);
        byKey.set(key, day);
        if (!strays) {
          warnings.push('Feature race deadlines: ' + dayMonth(at)
            + ' is not in the export, so the day was added for the feature lines.');
        }
      }
      // one group per stage, latest stage first
      const stages = [...new Set(list.map(f => f.stage))].sort((a, b) => {
        const ia = STAGES.indexOf(a.toLowerCase()), ib = STAGES.indexOf(b.toLowerCase());
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      const built = stages.map(stage => ({
        key: 'feature_race',
        header: ('FEATURE RACE ' + stage).toUpperCase(),
        items: list.filter(f => f.stage === stage).map(f =>
          f.race + ' ' + f.time + (f.meeting ? ' (' + f.meeting + ')' : ''))
      }));
      featureLines += built.reduce((n, g) => n + g.items.length, 0);
      day.groups = built.concat(day.groups);
    }
    // a day the export listed only for its features now has nothing to print
    for (let i = days.length - 1; i >= 0; i--) if (!days[i].groups.length) days.splice(i, 1);
    days.sort((a, b) => {
      const x = dayParts(a), y = dayParts(b);
      if (!x || !y) return 0;
      return ((x.y || 0) - (y.y || 0)) || (x.m - y.m) || (x.d - y.d);
    });
  }

  (corrections || []).forEach(c => {
    const day = byKey.get(c.key);
    if (!day) { warnings.push('Meeting corrections: no ' + dayMonth(c.at) + ' in the export, so "' + c.supplied + '" was not applied.'); return; }
    const want = headingKey(c.heading);
    const groups = day.groups.filter(g => !want || headingKey(g.header) === want);
    let hit = false;
    (groups.length ? groups : day.groups).forEach(g => {
      g.items = g.items.map(it => {
        const m = clean(it).match(/^(.*?)\s+(\d{1,2}[.:]\d{2}\s*[ap]m)(.*)$/i);
        const venue = m ? m[1] : clean(it);
        if (headingKey(venue) !== headingKey(c.supplied)) return it;
        hit = true; applied++;
        const name = c.printAs || venue;
        const time = c.time || (m ? m[2] : '');
        const rest = m ? m[3] : '';
        return (name + (time ? ' ' + time : '') + rest).replace(/\s+/g, ' ').trim();
      });
    });
    if (!hit) {
      warnings.push('Meeting corrections: "' + c.supplied + '" is not listed under '
        + (c.heading || 'any heading') + ' on ' + dayMonth(c.at) + ' — check the spelling against the export.');
    }
  });

  return { days, warnings, featureLines, corrections: applied };
}

export async function loadDeadlines(url, opts) {
  const o = opts || {};
  const { text } = await fetchDelimited(url);
  const { head, body } = rows(text);
  const warnings = [];

  const missing = ['date_order', 'date'].concat(GROUPS.map(g => g[1])).filter(c => !head.includes(c));
  if (missing.length) warnings.push('Export is missing expected columns: ' + missing.join(', '));

  let days = body.map((r, i) => {
    const line = 'row ' + (i + 2);
    const groups = [];
    GROUPS.forEach(([hk, vk]) => {
      const items = splitLines(r[vk]);
      if (!items.length) return;
      const header = (r[hk] || '').trim();
      if (!header) warnings.push('Deadlines listed with no heading in ' + vk + ' — ' + line);
      groups.push({ key: vk, header: header || vk.replace(/_/g, ' ').toUpperCase(), items });
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

  let adjusted = { featureLines: 0, corrections: 0 };
  if (o.adjust !== false) {
    const [fr, mc] = await Promise.all([
      loadFeatureDeadlines(o.features).catch(e => ({ rows: [], warnings: ['Feature race deadlines: ' + (e.message || e)], present: true })),
      loadMeetingCorrections(o.corrections).catch(e => ({ rows: [], warnings: ['Meeting corrections: ' + (e.message || e)], present: true }))
    ]);
    warnings.push(...fr.warnings, ...mc.warnings);
    if (!fr.present) {
      warnings.push('No "Feature Race Deadlines - Entry Deadlines.xlsx" in the folder, so the feature race lines print as the export calculates them — six days out, one entry and one acceptance per race.');
    }
    const r = applyAdjustments(days, fr.rows, mc.rows);
    days = r.days;
    warnings.push(...r.warnings);
    adjusted = { featureLines: r.featureLines, corrections: r.corrections };
  }

  return { days, warnings, count: days.length, adjusted };
}
