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

import { fetchDelimited, rows } from './tsv.js';

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

export async function loadPrograms(url, edition) {
  const { text } = await fetchDelimited(url);
  const { head, body } = rows(text);
  const warnings = [];

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
      dist: r[C.dist] || '', cond: r[C.cond] || '',
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
    if (printed.length !== meetings.length || setAside.length) {
      warnings.push('Export holds a full year: ' + (meetings.length + setAside.length) + ' meetings, of which '
        + setAside.length + ' are jump-outs or trials with no prizemoney. Printing the ' + printed.length
        + ' race meetings in ' + label + (asideInWindow ? ' and leaving ' + asideInWindow + ' jump-out/trial meeting(s) in that window to page 50' : '') + '.');
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

  // per-race checks, only for the meetings this edition prints
  meetings.forEach(m => {
    if (m.noDate) warnings.push('No meeting date for ' + m.venue + '.');
    m.races.forEach(r => {
      const line = 'row ' + r.row + ' (' + m.venue + ' race ' + (r.no || '?') + ')';
      if (!r.no) warnings.push('No race number — ' + line);
      if (!r.name) warnings.push('No race name — ' + line);
      if (!r.dist) warnings.push('No distance — ' + line);
      if (!r.cond) warnings.push('No conditions — ' + line);
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
  return { meetings, warnings, count: meetings.length, races };
}
