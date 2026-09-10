// Pagination — one authority for what page each section starts on.
//
// Folios are an OUTPUT, not a setting. Section lengths move with the month's
// volume, so nobody should be typing page numbers into Edition Settings. This
// module holds the printed running order and adds up the pages in front of a
// section to get its first folio.
//
// Two kinds of length:
//
//   fixed     the section is always the same extent (one page of notices)
//   flowing   the extent depends on how much data came in — Entry Deadlines,
//             the Programs Summary Chart and Race Programs all fill columns
//             until they run out of room
//
// A flowing section can only be counted by laying it out, which its own page
// does. So each flowing page calls report() with the number of pages it just
// produced; the count is cached for the session and every other page picks it
// up. Until a section has been opened once, its FALLBACK is used and the
// console says so.
//
// Two sections are conditional: the Jumps Program and Picnic Racing come in
// some months and not others. Edition Settings carries jumps_included and
// picnics_included; when a flag is No the section takes no pages and
// everything after it moves up.

import { fullPages } from './ads.js';

const STORE = 'ir.pagecounts';

export const SPINE = [
  { id: 'cover', label: 'Cover', fixed: 1, artwork: true },
  { id: 'stableline', label: 'Stableline notice', fixed: 1, artwork: true },
  { id: 'deadlines', label: 'Entry Deadlines', flowing: true, fallback: 2 },
  { id: 'chart', label: 'Programs Summary Chart', flowing: true, fallback: 8 },
  { id: 'programs', label: 'Race Programs', flowing: true, fallback: 23 },
  { id: 'permits', label: 'Permits to Ride, Eligible to Ride in Trials', fixed: 1 },
  { id: 'agents', label: 'Riders\u2019 Agents', flowing: true, fallback: 1 },
  { id: 'jumps', label: 'Jumps Program, Trials and Prizemoney', fixed: 1, flag: 'jumps_included' },
  { id: 'jumpouts', label: 'Jump-Outs, Flat Trials, Division of Races', flowing: true, fallback: 1 },
  { id: 'series', label: 'Victorian Race Series', flowing: true, fallback: 1 },
  { id: 'picnics', label: 'Picnic Racing', flowing: true, fallback: 2, flag: 'picnics_included' },
  { id: 'notice', label: 'Industry Notice', flowing: true, fallback: 1 },
  { id: 'stewards', label: 'From the Stewards\u2019 Room', flowing: true, fallback: 1 },
  { id: 'rules', label: 'Rules and Notices', flowing: true, fallback: 1 },
  { id: 'fullpage', label: 'Full-page advertising', fixed: 1, artwork: true, ads: true },
  { id: 'backcover', label: 'Back cover', fixed: 1, artwork: true }
];

/** Yes/No/true/1 -> boolean. Anything unrecognised counts as not included. */
export function flag(value) {
  return /^(yes|y|true|1|included)$/i.test(String(value || '').trim());
}

function cache() {
  try { return JSON.parse(sessionStorage.getItem(STORE) || '{}'); } catch (e) { return {}; }
}

/**
 * A flowing section tells pagination how many pages it produced. Call it once
 * per render, after the pages array is built.
 */
export function report(id, count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < 1) return;
  const c = cache();
  if (c[id] === n) return;
  c[id] = n;
  try { sessionStorage.setItem(STORE, JSON.stringify(c)); } catch (e) { /* private mode */ }
}

/**
 * Works out the running order for this edition.
 * Returns { start, count, sections, total, signatures, warnings }.
 *   start[id]  first folio of that section (0 if it is not in this edition)
 *   count[id]  its extent in pages
 */
export function plan(settings, placements) {
  const s = settings || {};
  const measured = cache();
  const warnings = [];
  const missing = [];
  const sections = [];
  const start = {};
  const count = {};
  let page = 1;

  SPINE.forEach(sec => {
    const included = !sec.flag || flag(s[sec.flag]);
    let n = 0;
    if (included) {
      if (sec.flowing) {
        n = measured[sec.id];
        if (!n) { n = sec.fallback; missing.push(sec.label); }
      } else {
        n = sec.fixed;
      }
    }
    start[sec.id] = included ? page : 0;
    count[sec.id] = n;
    sections.push({
      id: sec.id,
      label: sec.label,
      included,
      pages: n,
      first: included ? page : 0,
      last: included ? page + n - 1 : 0,
      estimated: included && !!sec.flowing && !measured[sec.id],
      artwork: !!sec.artwork
    });
    page += n;
  });

  // Whole-page advertising absorbs the signature shortfall: the spine counts
  // one full page, and however many more are needed to reach a multiple of
  // four run as extra ads rather than blank paper. Everything after them moves
  // down, so this has to happen before the folios are read back.
  const provisional = page - 1;
  const ads = fullPages(provisional, placements);
  const extra = ads.length - 1;
  if (extra > 0) {
    const at = sections.findIndex(x => x.id === 'fullpage');
    if (at >= 0) {
      sections[at].pages += extra;
      sections[at].last += extra;
      count.fullpage += extra;
      for (let i = at + 1; i < sections.length; i++) {
        if (!sections[i].included) continue;
        sections[i].first += extra;
        sections[i].last += extra;
        start[sections[i].id] += extra;
      }
      page += extra;
    }
  }

  const total = page - 1;
  const signatures = Math.ceil(total / 4);
  const padding = signatures * 4 - total;

  if (missing.length) {
    warnings.push('Pagination: using the standing extent for ' + missing.join(', ')
      + ' \u2014 open those pages first and the folios settle to the real count.');
  }
  if (extra > 0) {
    warnings.push('Advertising: the edition carries ' + ads.length + ' whole pages ('
      + ads.map(a => a.name).join(', ') + ') — one standing, '
      + extra + ' more to bring ' + provisional + ' pages up to a multiple of four.');
  }
  if (padding) {
    warnings.push('Pagination: the edition runs ' + total + ' pages. Saddle-stitch needs a multiple of four, so '
      + padding + ' page' + (padding > 1 ? 's' : '') + ' of filler or advertising is needed to reach '
      + (signatures * 4) + '.');
  }
  SPINE.filter(x => x.flag).forEach(x => {
    const raw = String(s[x.flag] || '').trim();
    if (!raw) warnings.push('Edition Settings: "' + x.flag + '" is blank \u2014 ' + x.label + ' is left out of this edition.');
    else if (!/^(yes|no|y|n|true|false|1|0)$/i.test(raw)) {
      warnings.push('Edition Settings: "' + x.flag + '" is "' + raw + '", expected Yes or No.');
    }
  });

  return { start, count, sections, total, signatures, padded: signatures * 4, padding, ads, warnings };
}

/** Convenience: the first folio of a section, as a string for the page furniture. */
export function folio(settings, id) {
  return String(plan(settings).start[id] || '');
}
