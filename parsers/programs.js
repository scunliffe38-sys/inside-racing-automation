// Race Programs (pages 27+) — reads the professional race programs export.
//
// Source: inputs/Race Programs.csv — tab separated, UTF-16, one row per race.
// Meeting-level columns are only filled on a meeting's first race, so they are
// carried forward. Races are grouped into meetings in export order.
//
// The export is a full year of programming, not one edition's worth. The printed
// section runs the edition month and the two months after it — August 2026 prints
// August, September and October — so loadPrograms() takes the edition string and
// keeps only the meetings inside that window. Everything else is set aside and
// counted in a console note.
//
// meet_date_filter has arrived as both D/M/YYYY and M/D/YYYY, so the month comes
// from the "Thursday, 8 January 2026" text where it exists and the filter column
// is only used as a fallback, with its order sniffed from the whole column.
//
// The export also mixes three kinds of meeting: race meetings, jump-outs
// ("Jump Out - Good 4", no conditions and no prizemoney) and official trials.
// Only race meetings belong in this section — jump-outs and trials are printed on
// page 50 from their own exports — so a meeting is kept when at least one of its
// races carries prizemoney, and the rest are counted in a console note.
//
// Setting those aside is the normal course of a run, not a fault, so the count
// goes back as a note rather than a warning: notes describe what the parser did,
// warnings are for gaps in the input that somebody has to go and fix.

//
// Four optional workbooks the team keeps by hand sit over the export, because
// it cannot produce what they carry. Each is matched on the meeting's date and
// venue; a folder without them prints the export as it stands.
//
//   inputs/Add Twilight in Race Program.xlsx     Date | Venue
//     prints (TWILIGHT) after the venue, where (NIGHT) sits on a night meeting
//   inputs/Race Program - Race Name Updates.xlsx Date | Venue | Race No | Race Name
//     replaces the export's race name, e.g. a HANDICAP that has a real title
//   inputs/Country run as Metro.xlsx             Date | Venue
//     a country venue running a metropolitan meeting prints red, not blue
//   inputs/The Valley Transfer meetings.xlsx     Date | Venue
//     prints "THE VALLEY AT" before the venue
//
// A race whose conditions column is blank prints "Open" in the grey bar.

import { fetchDelimited, rows } from './tsv.js';
import { readSheet } from './xlsx.js';

export const ADJUST_FILES = {
  twilight: 'inputs/Add Twilight in Race Program.xlsx',
  names: 'inputs/Race Program - Race Name Updates.xlsx',
  metro: 'inputs/Country run as Metro.xlsx',
  valley: 'inputs/The Valley Transfer meetings.xlsx'
};

const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const venueKey = v => clean(v).toLowerCase().replace(/\([^)]*\)/g, '').replace(/^the valley at\s+/, '').replace(/[^a-z]/g, '');
const sameVenue = (a, b) => { const x = venueKey(a), y = venueKey(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };
const dkey = p => p ? p.y + '-' + String(p.m + 1).padStart(2, '0') + '-' + String(p.d).padStart(2, '0') : '';
const MON3 = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

/** A date typed in a team sheet: an Excel serial, "8 Oct 2026", or 8/10/2026 (day first). */
function sheetDate(v) {
  const s = clean(v);
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 20000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
  }
  const t = s.match(/(\d{1,2})[ \-/]+([A-Za-z]{3,})\.?[ \-/,]+(\d{2,4})/);
  if (t) {
    const mi = MON3.indexOf(t[2].toLowerCase().slice(0, 3));
    let y = +t[3]; if (y < 100) y += 2000;
    if (mi >= 0) return { y, m: mi, d: +t[1] };
  }
  const n = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (n) { let y = +n[3]; if (y < 100) y += 2000; return { y, m: +n[2] - 1, d: +n[1] }; }
  return null;
}

/** The meeting's own day, from "Thursday, 8 October 2026", else the filter column. */
function dayOf(dateText, filterValue, order) {
  const t = String(dateText || '').match(/(\d{1,2})\s+([A-Za-z]+)\s+(20\d\d)/);
  if (t) {
    const mi = MON3.indexOf(t[2].toLowerCase().slice(0, 3));
    if (mi >= 0) return { y: +t[3], m: mi, d: +t[1] };
  }
  const p = String(filterValue || '').split('/');
  if (p.length === 3) {
    const d = order === 'dmy' ? +p[0] : +p[1], m = order === 'dmy' ? +p[1] : +p[0];
    if (m >= 1 && m <= 12) return { y: +p[2], m: m - 1, d };
  }
  return null;
}

async function teamSheet(url, cols, label, warnings) {
  let res;
  try { res = await fetch(url); } catch (e) { return null; }
  if (!res || !res.ok) return null;
  let raw;
  try { raw = await readSheet(await res.blob()); }
  catch (e) { warnings.push(label + ': cannot read the workbook (' + (e.message || e) + ').'); return []; }
  const letters = ['A', 'B', 'C', 'D'];
  const out = [];
  raw.forEach((r, i) => {
    const vals = letters.map(l => clean(r[l]));
    if (i === 0 && /^date$/i.test(vals[0])) return;
    if (!vals.some(Boolean) || vals[0].charAt(0) === '#') return;
    const o = { row: i + 1 };
    cols.forEach((c, j) => { o[c] = vals[j] || ''; });
    o.at = sheetDate(o.date);
    if (!o.at) { warnings.push(label + ': cannot read the date "' + o.date + '" — row ' + o.row + '.'); return; }
    if (!o.venue) { warnings.push(label + ': no venue — row ' + o.row + '.'); return; }
    out.push(o);
  });
  return out;
}

/** Puts the four team sheets over the printed meetings. */
async function applyTeamSheets(meetings, order, inWindow, warnings, notes, files) {
  const F = Object.assign({}, ADJUST_FILES, files || {});
  const [tw, nm, mt, va] = await Promise.all([
    teamSheet(F.twilight, ['date', 'venue'], 'Add Twilight', warnings),
    teamSheet(F.names, ['date', 'venue', 'no', 'name'], 'Race name updates', warnings),
    teamSheet(F.metro, ['date', 'venue'], 'Country run as Metro', warnings),
    teamSheet(F.valley, ['date', 'venue'], 'The Valley Transfer', warnings)
  ]);
  meetings.forEach(m => { m.day = dkey(dayOf(m.date, m.key.split('|')[0], order)); });
  // exact venue first, so "Southside Pakenham" never lands on Southside Pakenham
  // Synthetic; a sheet venue carrying "(Night)" only matches the night meeting
  const find = r => {
    const day = meetings.filter(m => m.day === dkey(r.at));
    const names = m => [m.venue, m.key.split('|')[1]];
    let hit = day.filter(m => names(m).some(v => venueKey(v) === venueKey(r.venue)));
    if (!hit.length) hit = day.filter(m => names(m).some(v => sameVenue(v, r.venue)));
    if (/\(night\)/i.test(r.venue)) hit = hit.filter(m => /night/i.test(m.night)).concat(hit.filter(m => !/night/i.test(m.night))).slice(0, 1);
    else if (hit.length > 1) hit = hit.filter(m => !/night/i.test(m.night)).concat(hit).slice(0, 1);
    return hit[0];
  };
  const miss = (label, r) => {
    const txt = label + ': no ' + r.venue + ' meeting on ' + r.date + ' in the program export — row ' + r.row + '.';
    if (inWindow(r.at)) warnings.push(txt + ' Check the date and spelling.'); else notes.push(label + ': ' + r.venue + ' ' + r.date + ' is outside this edition, left for later.');
  };
  let n = { tw: 0, nm: 0, mt: 0, va: 0 };
  (tw || []).forEach(r => { const m = find(r); if (!m) return miss('Add Twilight', r); m.night = '(TWILIGHT)'; n.tw++; });
  (mt || []).forEach(r => { const m = find(r); if (!m) return miss('Country run as Metro', r); m.metro = true; n.mt++; });
  (va || []).forEach(r => {
    const m = find(r); if (!m) return miss('The Valley Transfer', r);
    if (!/^the valley at\s/i.test(m.venue)) m.venue = 'The Valley at ' + m.venue;
    n.va++;
  });
  (nm || []).forEach(r => {
    if (!r.name) { warnings.push('Race name updates: no new name — row ' + r.row + '.'); return; }
    const m = find(r); if (!m) return miss('Race name updates', r);
    const race = m.races.find(x => String(Number(x.no)) === String(Number(r.no)));
    if (!race) { warnings.push('Race name updates: ' + m.venue + ' ' + r.date + ' has no race ' + (r.no || '(blank)') + ' — row ' + r.row + '.'); return; }
    race.name = r.name; n.nm++;
  });
  const done = [n.tw && n.tw + ' twilight', n.mt && n.mt + ' country-as-metro', n.va && n.va + ' Valley transfer', n.nm && n.nm + ' race name update(s)'].filter(Boolean);
  if (done.length) notes.push('Race program adjustments applied: ' + done.join(', ') + '.');
  return { twilight: n.tw, names: n.nm, metro: n.mt, valley: n.va };
}

const C = {
  dateKey: 'meet_date_filter',
  venueKey: 'meet_day_venue_name_filter',
  date: 'meet_date',
  venue: 'meet_day_venue_name',
  night: 'night_race',
  no: 'race_number',
  name: 'name_race_full',
  group: 'group_type',
  dist: 'race_distance',
  cond: 'race_conditions',
  claim: 'claim',
  bonus: 'bonus_scheme_description',
  notation: 'notation',
  prize: 'prize_money_description',
  weight: 'entry_weight',
  nomFee: 'nomination_fee',
  accFee: 'acceptance_fee',
  decl: 'declaration',
  penH: 'penalties_header',
  pen: 'penalties',
  balH: 'ballot_header',
  bal: 'ballot',
  other: 'other_information',
  nomH: 'nominations_close_header',
  nom: 'nominations_close',
  accH: 'acceptance_close_header',
  acc: 'acceptance_close'
};

// the printed edition prints metropolitan meetings red, country blue
const METRO = [
  'flemington', 'caulfield', 'caulfield heath', 'moonee valley',
  'sandown hillside', 'sandown lakeside', 'sportsbet sandown hillside',
  'sportsbet sandown lakeside'
];

const isMetro = venue => {
  const v = String(venue || '').toLowerCase();
  return METRO.some(m => v.includes(m));
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_LABEL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** "AUGUST EDITION 2026" -> { m: 7, y: 2026 } */
function editionMonth(edition) {
  const s = String(edition || '').toLowerCase();
  const m = MONTHS.findIndex(x => s.includes(x));
  const y = (s.match(/(20\d\d)/) || [])[1];
  const now = new Date();
  return { m: m < 0 ? now.getMonth() : m, y: y ? +y : now.getFullYear() };
}

/** Is the filter column D/M/YYYY or M/D/YYYY? Decided from the whole column. */
function sniffOrder(values) {
  let dayFirst = 0, monthFirst = 0;
  values.forEach(v => {
    const parts = String(v || '').split('/');
    if (parts.length !== 3) return;
    const a = +parts[0], b = +parts[1];
    if (a > 12 && b <= 12) dayFirst++;
    else if (b > 12 && a <= 12) monthFirst++;
  });
  return dayFirst > monthFirst ? 'dmy' : 'mdy';
}

/** Month and year for a meeting, from its printed date if possible. */
function whenOf(dateText, filterValue, order) {
  const t = String(dateText || '').toLowerCase();
  const mi = MONTHS.findIndex(x => t.includes(x));
  const yr = (String(dateText || '').match(/(20\d\d)/) || [])[1];
  if (mi >= 0 && yr) return { m: mi, y: +yr };
  const parts = String(filterValue || '').split('/');
  if (parts.length === 3) {
    const m = order === 'dmy' ? +parts[1] : +parts[0];
    const y = +parts[2];
    if (m >= 1 && m <= 12 && y > 2000) return { m: m - 1, y };
  }
  return null;
}

/** "September 2026" or "September to November 2026" for a set of meetings. */
function spanOf(list) {
  const keys = list.map(m => m.when).filter(Boolean).map(w => w.y * 12 + w.m).sort((a, b) => a - b);
  if (!keys.length) return '';
  const lo = keys[0], hi = keys[keys.length - 1];
  const month = k => MONTH_LABEL[k % 12];
  const year = k => Math.floor(k / 12);
  if (lo === hi) return month(lo) + ' ' + year(lo);
  // the year rides on the end unless the span crosses into another one
  return month(lo) + (year(lo) === year(hi) ? '' : ' ' + year(lo)) + ' to ' + month(hi) + ' ' + year(hi);
}

export async function loadPrograms(url, edition, opts) {
  const o = opts || {};
  const { text } = await fetchDelimited(url);
  const { head, body } = rows(text);
  const warnings = [];
  const notes = [];

  const missing = [C.dateKey, C.venueKey, C.no, C.name, C.dist, C.cond].filter(c => !head.includes(c));
  if (missing.length) warnings.push('Export is missing expected columns: ' + missing.join(', '));

  let meetings = [];
  const byKey = new Map();
  let lastDate = '', lastVenue = '';

  body.forEach((r, i) => {
    const key = (r[C.dateKey] || '') + '|' + (r[C.venueKey] || '');
    let m = byKey.get(key);
    if (!m) {
      // meeting-level columns only appear on the meeting's first race
      lastDate = r[C.date] || lastDate;
      lastVenue = r[C.venue] || r[C.venueKey] || lastVenue;
      m = {
        key,
        venue: lastVenue,
        date: r[C.date] || lastDate,
        night: r[C.night] || '',
        metro: isMetro(lastVenue),
        races: []
      };
      if (!m.date) m.noDate = true;
      byKey.set(key, m);
      meetings.push(m);
    }
    m.races.push({
      row: i + 2,
      no: r[C.no] || '', name: r[C.name] || '', group: r[C.group] || '',
      dist: r[C.dist] || '', cond: clean(r[C.cond]) || 'Open',
      claim: r[C.claim] || '', bonus: r[C.bonus] || '', notation: r[C.notation] || '',
      prize: r[C.prize] || '', weight: r[C.weight] || '',
      nomFee: r[C.nomFee] || '', accFee: r[C.accFee] || '', decl: r[C.decl] || '',
      penH: r[C.penH] || '', pen: r[C.pen] || '',
      balH: r[C.balH] || '', bal: r[C.bal] || '',
      other: r[C.other] || '',
      nomH: r[C.nomH] || '', nom: r[C.nom] || '',
      accH: r[C.accH] || '', acc: r[C.acc] || ''
    });
  });

  // the export is a full year; the edition prints its own month plus the next two
  const order = sniffOrder(body.map(r => r[C.dateKey]));
  meetings.forEach(m => { m.when = whenOf(m.date, m.key.split('|')[0], order); });
  // jump-outs and trials ride along in the same export; they have no prizemoney
  const isRaceMeeting = m => m.races.some(r => String(r.prize || '').trim());
  const setAside = meetings.filter(m => !isRaceMeeting(m));
  meetings = meetings.filter(isRaceMeeting);

  let printed = meetings;
  if (edition) {
    const { m: em, y: ey } = editionMonth(edition);
    const window = [0, 1, 2].map(k => {
      const d = new Date(Date.UTC(ey, em + k, 1));
      return { m: d.getUTCMonth(), y: d.getUTCFullYear() };
    });
    const inWindow = m => m.when && window.some(w => w.m === m.when.m && w.y === m.when.y);
    printed = meetings.filter(inWindow);
    const undatedDropped = meetings.filter(m => !m.when);
    if (undatedDropped.length) {
      warnings.push(undatedDropped.length + ' meeting(s) have no readable date and cannot be placed in the edition window: '
        + undatedDropped.slice(0, 6).map(m => m.venue || '(no venue)').join(', ')
        + (undatedDropped.length > 6 ? ', …' : '') + '.');
    }
    const label = MONTH_LABEL[window[0].m] + ' to ' + MONTH_LABEL[window[2].m] + ' ' + window[2].y;
    const asideInWindow = setAside.filter(m => {
      const w = whenOf(m.date, m.key.split('|')[0], order);
      return w && window.some(x => x.m === w.m && x.y === w.y);
    }).length;
    const dropped = meetings.filter(m => m.when).length - printed.length;
    if (printed.length !== meetings.length || setAside.length) {
      const span = spanOf(meetings.concat(setAside));
      notes.push('Export holds ' + (meetings.length + setAside.length) + ' meetings'
        + (span && span !== label ? ' (' + span + ')' : '') + '. Printing the ' + printed.length + ' race meetings in ' + label
        + (dropped > 0 ? '; ' + dropped + ' race meeting(s) fall outside that window' : '')
        + (setAside.length ? '; ' + setAside.length + ' jump-out/trial meeting(s) set aside'
          + (asideInWindow && asideInWindow !== setAside.length ? ' (' + asideInWindow + ' of them in the window)' : '')
          + ' — those print on page 50 from their own exports' : '') + '.');
    }
    if (!printed.length) {
      warnings.push('No meetings fall in ' + label + ' — check the edition name in Edition Settings against the export.');
    }
    printed.sort((a, b) => {
      if (!a.when || !b.when) return 0;
      return a.when.y - b.when.y || a.when.m - b.when.m;
    });
  }
  meetings = printed;

  let adjusted = { twilight: 0, names: 0, metro: 0, valley: 0 };
  if (o.adjust !== false) {
    let inWin = () => true;
    if (edition) {
      const { m: em, y: ey } = editionMonth(edition);
      inWin = at => { const k = at.y * 12 + at.m, lo = ey * 12 + em; return k >= lo && k <= lo + 2; };
    }
    adjusted = await applyTeamSheets(meetings, order, inWin, warnings, notes, o.files);
  }

  // per-race checks, only for the meetings this edition prints
  meetings.forEach(m => {
    if (m.noDate) warnings.push('No meeting date for ' + m.venue + '.');
    m.races.forEach(r => {
      const line = 'row ' + r.row + ' (' + m.venue + ' race ' + (r.no || '?') + ')';
      if (!r.no) warnings.push('No race number — ' + line);
      if (!r.name) warnings.push('No race name — ' + line);
      if (!r.dist) warnings.push('No distance — ' + line);
      if (!r.prize) warnings.push('No prizemoney — ' + line);
    });
    const nos = m.races.map(r => Number(r.no));
    if (nos.some(n => !isFinite(n))) return;
    for (let i = 1; i <= nos.length; i++) {
      if (!nos.includes(i)) { warnings.push(m.venue + ' ' + m.date + ' is missing race ' + i + '.'); break; }
    }
  });
  if (!meetings.length) warnings.push('No meetings found in ' + url);

  const races = meetings.reduce((n, m) => n + m.races.length, 0);
  return { meetings, warnings, notes, count: meetings.length, races, adjusted };
}
