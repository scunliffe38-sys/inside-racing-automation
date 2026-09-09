// Advertising — the house library, where ads may sit, and how many run.
//
// Read from the August 2026 edition, which places advertising three ways:
//
//   a standing panel in space a section did not use   (Stableline, page 2)
//   a photo filling the tail of a short section page  (Off The Track, page 49)
//   a whole page of supplied artwork                  (HR Assist, page 55)
//
// The library lives in the project, not in inputs/: the house ads recur every
// edition. Artwork is supplied as PNG under assets/ads/ at native resolution.
// When a new advertisement arrives, drop the artwork in assets/ads/ and add an
// entry below — `kind` is how it prints, `slots` is where it may go, and
// `enabled: false` benches an ad without deleting it.
//
// The cover photograph is not advertising and changes every month, so it is an
// input: inputs/Cover.jpg, overwritten each edition.
//
// Two rules decide placement:
//
//   fixed slots    named positions that always take an ad — the Stableline
//                  panel on the contents page, the filler under the Jumps
//                  Program, the full page before the back cover
//   automatic fill any page leaving more than BLANK_THRESHOLD of its depth
//                  empty gets offered a filler, largest gap first
//
// Full-page count is not fixed. Saddle-stitch needs a multiple of four, so
// fullPageCount() returns however many whole-page ads bring the edition up to
// the next signature — one at minimum, since the page before the back cover
// always carries one.

/** A page is a filler candidate when this much of its depth is unused. */
export const BLANK_THRESHOLD = 0.40;

/** Trim box of an A4 page in points, less the standing 24pt margins. */
const LIVE_DEPTH = 842 - 48;

// ---- bookable slots ---------------------------------------------------------
//
// The named positions a producer may book, and the artwork each wants. These
// ids are what goes in the slot column of inputs/Ad Placements.csv, and they
// are what the placement report prints. Sizes are the printed area, in
// millimetres; artwork at or above the pixel size prints at 300dpi or better.

export const SLOTS = [
  {
    id: 'contents-panel', kind: 'panel', where: 'Contents page, below the section list',
    widthMm: 190, heightMm: 85, widthPx: 2244, heightPx: 1004, house: 'stableline'
  },
  {
    id: 'jumps-filler', kind: 'filler', where: 'Foot of the Jumps Racing Program page',
    widthMm: 90, heightMm: 98, widthPx: 1063, heightPx: 1157, house: 'ott'
  },
  {
    id: 'fullpage-1', kind: 'full', where: 'Whole page, immediately before the back cover',
    widthMm: 210, heightMm: 297, widthPx: 2480, heightPx: 3508, house: 'hrassist'
  }
];

// Signature padding pages are bookable too, but only exist when the edition
// comes up short of a multiple of four. They are reported as fullpage-2, -3, -4
// once the page count is known.
const fullPageSlot = n => ({
  id: 'fullpage-' + n, kind: 'full',
  where: n === 1 ? SLOTS[2].where : 'Whole page, signature padding before the back cover',
  widthMm: 210, heightMm: 297, widthPx: 2480, heightPx: 3508, house: null
});

export const slotById = id => SLOTS.find(s => s.id === id) || null;

export const LIBRARY = [
  {
    id: 'stableline',
    name: 'Stableline',
    kind: 'panel',            // sits in leftover space on a content page
    artwork: 'assets/ads/stableline.png',
    width: 1240,
    height: 553,
    contact: '1300 520 122',
    slots: ['contents'],
    enabled: true
  },
  {
    id: 'ott',
    name: 'Off The Track',
    kind: 'filler',           // photo or panel filling the tail of a page
    artwork: 'assets/photos/off-the-track-handler.png',
    width: 767,
    height: 835,
    heading: 'Transition Pathway Programs',
    slots: ['jumps', 'auto'],
    enabled: true
  },
  {
    id: 'hrassist',
    name: 'HR Assist',
    kind: 'full',             // whole page of supplied artwork
    artwork: 'assets/ads/hr-assist-full-page.png',
    overlay: 'assets/ads/hr-assist-secondary.png',
    width: 1187,
    height: 837,
    // Copy as set in the August 2026 edition. The blue chevron is artwork; the
    // type is live, so it is held here and typeset on the page.
    headline: 'Award wages are increasing from the first full pay period on or after 1 July 2026.',
    body: 'For free and confidential guidance, contact HR Assist via the channels below and state that you require advice under the Racing Victoria HR Assist support service.',
    hours: 'HR Assist available weekdays (Mon to Fri) 9am-5pm',
    contact: '1300 884 687   rvhra@ihraustralia.com',
    slots: ['prebackcover', 'auto'],
    enabled: true
  }
];

const byId = id => LIBRARY.find(a => a.id === id) || null;

// ---- inputs/Ad Placements.csv ------------------------------------------------
//
// Tab-separated, one row per booked slot:
//
//   slot   artwork   caption   enabled   notes
//
// `slot` is an id from SLOTS (or fullpage-N). `artwork` is a filename dropped
// in inputs/ads/ — house artwork already in the project is found by bare name
// too, so the standing ads need no file supplied. `enabled` no benches a slot
// for one edition: it runs empty rather than falling back to the house ad.
// A slot with no row at all keeps its house ad.

const ART_DIRS = ['inputs/ads/', 'assets/ads/', 'assets/photos/'];

async function findArtwork(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  if (n.indexOf('/') >= 0) return n;
  for (const d of ART_DIRS) {
    try {
      const res = await fetch(d + n, { method: 'GET' });
      if (res.ok) return d + n;
    } catch (e) { /* absent */ }
  }
  return null;
}

const yes = v => !/^(no|n|false|0|off)$/i.test(String(v == null ? '' : v).trim());

/**
 * Read the producer's placement file. Returns { rows, bySlot, warnings }.
 * Missing file is not an error — the edition simply runs its house ads.
 */
export async function loadPlacements(url) {
  const warnings = [];
  let text;
  try {
    const res = await fetch(url || 'inputs/Ad Placements.csv');
    if (!res.ok) throw new Error(String(res.status));
    text = await res.text();
  } catch (e) {
    return { rows: [], bySlot: {}, warnings: ['No Ad Placements.csv found — running house advertising only.'] };
  }
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim());
  const head = (lines.shift() || '').split('\t').map(h => h.trim().toLowerCase());
  const col = name => head.indexOf(name);
  const rows = [];
  const bySlot = {};
  for (const line of lines) {
    const c = line.split('\t').map(v => (v || '').trim());
    const slot = c[col('slot')] || '';
    if (!slot || slot.charAt(0) === '#') continue;
    if (!slotById(slot) && !/^fullpage-\d+$/.test(slot) && !/^page-\d+$/.test(slot)) {
      warnings.push('Unknown ad slot "' + slot + '" — row ignored. Slots: ' + SLOTS.map(s => s.id).join(', ') + ', fullpage-N, page-N.');
      continue;
    }
    if (bySlot[slot]) { warnings.push('Slot "' + slot + '" booked twice — the later row is ignored.'); continue; }
    const row = {
      slot,
      kind: (slotById(slot) || {}).kind || 'full',
      artworkName: c[col('artwork')] || '',
      caption: c[col('caption')] || '',
      enabled: yes(c[col('enabled')]),
      notes: c[col('notes')] || '',
      artwork: null
    };
    if (row.enabled && row.artworkName) {
      row.artwork = await findArtwork(row.artworkName);
      if (!row.artwork) warnings.push('Artwork "' + row.artworkName + '" for slot "' + slot + '" not found in inputs/ads/ — that slot falls back to its house ad.');
    }
    rows.push(row);
    bySlot[slot] = row;
  }
  return { rows, bySlot, warnings };
}

/**
 * What the producer may book this edition, with sizes — the pass-one placement
 * report. `total` is the page count as pagination has it, so the signature
 * padding pages appear alongside the standing slots. `placements` is the
 * loadPlacements() result, if it has already been read, so each slot reports
 * what is booked against it.
 */
export function slotReport(total, placements) {
  const booked = (placements && placements.bySlot) || {};
  const extra = Math.max(0, fullPages(total).length - 1);
  const all = SLOTS.concat(Array.from({ length: extra }, (_, i) => fullPageSlot(i + 2)));
  return all.map(s => {
    const b = booked[s.id];
    const house = s.house ? byId(s.house) : null;
    return {
      slot: s.id, kind: s.kind, where: s.where,
      sizeMm: s.widthMm + ' x ' + s.heightMm + ' mm',
      sizePx: s.widthPx + ' x ' + s.heightPx + ' px at 300dpi',
      booked: b && b.enabled && b.artwork ? b.artworkName : null,
      running: b && !b.enabled ? 'empty (benched this edition)'
        : b && b.artwork ? b.artworkName
        : house ? house.name + ' (house)'
        : 'unbooked'
    };
  });
}

/** Ads in rotation this edition. */
const live = () => LIBRARY.filter(a => a.enabled !== false);

// Fixed slot ids as the pages ask for them, mapped to the producer-facing ids
// used in Ad Placements.csv.
const SLOT_ALIAS = { contents: 'contents-panel', jumps: 'jumps-filler', prebackcover: 'fullpage-1' };

/**
 * The ad that owns a named fixed slot, or null. Pass the loadPlacements()
 * result as `placements` and a producer booking wins over the house library;
 * without it, or with the slot unbooked, the house ad runs as before.
 */
export function forSlot(slot, placements) {
  const id = SLOT_ALIAS[slot] || slot;
  const b = placements && placements.bySlot && placements.bySlot[id];
  if (b) {
    if (!b.enabled) return null;
    if (b.artwork) {
      const s = slotById(id);
      return {
        id: id, name: b.artworkName, kind: b.kind, artwork: b.artwork,
        heading: b.caption || undefined, booked: true,
        width: s ? s.widthPx : undefined, height: s ? s.heightPx : undefined
      };
    }
  }
  return live().find(a => (a.slots || []).indexOf(slot) >= 0) || null;
}

/**
 * Whole-page ads for this edition.
 *
 * `total` is the page count with exactly one full-page ad in it — what
 * pagination already computes. If that does not land on a multiple of four,
 * the shortfall runs as extra whole-page ads rather than blank paper.
 * Returns one entry per page, cycling the library's full-page artwork.
 */
export function fullPages(total, placements) {
  const n = Number(total) || 0;
  const short = n % 4 ? 4 - (n % 4) : 0;
  const wanted = 1 + short;
  const stock = live().filter(a => a.kind === 'full' && a.artwork);
  const out = [];
  for (let i = 0; i < wanted; i++) {
    const booked = forSlot('fullpage-' + (i + 1), placements);
    if (booked && booked.booked) { out.push(booked); continue; }
    out.push(stock.length ? stock[i % stock.length] : { id: 'reserved', name: 'Reserved', kind: 'full', artwork: null });
  }
  return out;
}

/** How many whole pages of advertising this edition carries. */
export function fullPageCount(total, placements) {
  return fullPages(total, placements).length;
}

/**
 * Does a page have enough unused depth to be worth filling?
 * `usedPt` is how far down the page the section's own content reaches.
 */
export function hasBlankSpace(usedPt, threshold) {
  const t = Number(threshold);
  const limit = Number.isFinite(t) ? t : BLANK_THRESHOLD;
  return (LIVE_DEPTH - Number(usedPt || 0)) / LIVE_DEPTH >= limit;
}

/**
 * Fillers for pages that came out short. `pages` is
 * [{ id, label, usedPt }] — usually the last page of each flowing section.
 * Returns [{ page, ad, gapPt }], deepest gap first, one ad per page and no ad
 * used twice unless the library runs out.
 */
export function fillers(pages, threshold) {
  const stock = live().filter(a => (a.slots || []).indexOf('auto') >= 0);
  if (!stock.length) return [];
  const candidates = (pages || [])
    .map(p => ({ page: p, gapPt: LIVE_DEPTH - Number(p.usedPt || 0) }))
    .filter(c => hasBlankSpace(LIVE_DEPTH - c.gapPt, threshold))
    .sort((a, b) => b.gapPt - a.gapPt);
  return candidates.map((c, i) => ({ page: c.page, gapPt: c.gapPt, ad: stock[i % stock.length] }));
}

/**
 * A bookable panel in whatever depth a page has left over.
 *
 * The producer books it by folio — `page-54` — which is the identifier the
 * placeholder prints, so what is on the page and what goes in
 * inputs/Ad Placements.csv are the same string. Returns a one-item list to
 * drop straight into a template, or an empty one when the page is full or the
 * slot has been switched off.
 *
 *   topPt     where the section's content starts
 *   usedPt    how deep it ran from there
 *   bottomPt  the last line the page can print on
 */
export function pageSlot(folio, topPt, usedPt, bottomPt, placements) {
  const bottom = Number(bottomPt) || 811.89;
  const contentEnd = (Number(topPt) || 0) + (Number(usedPt) || 0);
  const live = bottom - (Number(topPt) || 0);
  const gap = bottom - contentEnd;
  if (!folio || live <= 0 || gap / live < BLANK_THRESHOLD || gap < 140) return [];

  const id = 'page-' + folio;
  const booking = (placements && placements.bySlot && placements.bySlot[id]) || null;
  if (booking && !booking.enabled) return [];

  const top = contentEnd + 20;
  const height = bottom - top;
  const mm = n => Math.round(n * 0.3528);
  return [{
    id,
    top: top + 'pt',
    height: height + 'pt',
    size: mm(549.9) + ' \u00d7 ' + mm(height) + ' mm  \u00b7  ' + Math.round(549.9 / 72 * 300) + ' \u00d7 ' + Math.round(height / 72 * 300) + ' px at 300dpi',
    booked: !!(booking && booking.artwork),
    open: !(booking && booking.artwork),
    art: (booking && booking.artwork) || '',
    caption: (booking && booking.caption) || ''
  }];
}

export { byId };
