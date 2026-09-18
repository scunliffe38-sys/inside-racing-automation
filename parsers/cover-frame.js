// Cover framing.
//
// The cover photograph changes every edition and arrives framed for a camera,
// not for an A4 page with a masthead across the top and a teaser strip across
// the foot. August's frame is typical: nearly half the height is empty sky, the
// subject group sits in a band two-thirds down, and the page crops the sides.
//
// So rather than a fixed object-position, measure where the picture's interest
// actually is and place that in the part of the page nothing else covers.
//
// The measure is deliberately crude and deliberately cheap: subjects — people,
// horses, ironwork, crowd — carry local detail, while sky, grass and track do
// not. Summing edge energy by row and by column finds the subject band without
// anything resembling recognition. It is a framing aid, not a vision system.

const SAMPLE = 180;     // long edge of the analysis bitmap
const SHARE = 0.68;     // fraction of total energy the interest band must hold
const KEEP = 0.93;      // wider band the crop tries not to cut into
const EDGE = 0.03;      // share of the height averaged for the fill colour
const ONSET = 0.5;      // share of mean row energy that counts as subject
const FILL = 0.82;      // share of the clear depth the hero is sized to fill
const ACROSS = 0.88;    // share of the page width the hero may take
const AIR = 18;         // points of clear space held above and below the hero
const HERO = 0.5;       // energy share of the across-band measured on the hero

/**
 * Edge energy by column, counted only over a band of rows. Whole-frame column
 * energy cannot find the subject across the page: a grandstand runs the full
 * depth of the frame and carries more detail than a horse, so the band it
 * produces starts hard at the left edge. Counted over the rows the subject
 * actually occupies, and at a tighter share, the same measure lands on the
 * subject itself.
 */
function colsIn(data, w, h, y0, y1) {
  const out = new Float32Array(w);
  const a = Math.max(1, Math.min(h - 2, y0)), b = Math.max(a + 1, Math.min(h - 1, y1));
  for (let y = a; y < b; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, p = i * 4;
      const l = (q) => 0.2126 * data[q] + 0.7152 * data[q + 1] + 0.0722 * data[q + 2];
      const dx = Math.abs(l(p + 4) - l(p - 4));
      const dy = Math.abs(l(p + w * 4) - l(p - w * 4));
      const mx = Math.max(data[p], data[p + 1], data[p + 2]);
      const mn = Math.min(data[p], data[p + 1], data[p + 2]);
      out[x] += (dx + dy) * (0.6 + 0.8 * (mx === 0 ? 0 : (mx - mn) / mx));
    }
  }
  return out;
}

/** Luminance + saturation-weighted edge energy, summed by row and by column. */
function energy(data, w, h) {
  const lum = new Float32Array(w * h);
  const sat = new Float32Array(w * h);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat[i] = mx === 0 ? 0 : (mx - mn) / mx;
  }
  const rows = new Float32Array(h);
  const cols = new Float32Array(w);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const dx = Math.abs(lum[i + 1] - lum[i - 1]);
      const dy = Math.abs(lum[i + w] - lum[i - w]);
      // Saturation lifts a coloured subject clear of a grey or blown-out sky,
      // which can otherwise carry a surprising amount of cloud edge.
      const e = (dx + dy) * (0.65 + 0.35 * sat[i]);
      rows[y] += e;
      cols[x] += e;
    }
  }
  return { rows, cols };
}

/**
 * Where the subject starts, counting down from the top of the frame.
 *
 * The interest band answers a different question — where most of the energy
 * is — and on a frame filled with one large subject it starts well down even
 * though the subject's leading edge is near the top. October's cover is the
 * case: horse and jockey fill the frame, the band reads from 20% down, and a
 * test against it saw nothing behind the masthead while the horse's head was
 * plainly under the wordmark.
 *
 * So scan instead: the first row whose energy, smoothed over three rows, rises
 * to `ONSET` of the frame's mean. Sky, however bright, sits below that; a head
 * or a rail does not.
 */
function onset(rows) {
  const n = rows.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += rows[i];
  if (total <= 0) return 0;
  const bar = (total / n) * ONSET;
  for (let i = 1; i < n - 1; i++) {
    if ((rows[i - 1] + rows[i] + rows[i + 1]) / 3 >= bar) return i / n;
  }
  return 0;
}

/** Mean colour of the top or bottom edge rows, for the strip beside the photo. */
function edgeColour(data, w, h, atTop) {
  const band = Math.max(1, Math.round(h * EDGE));
  const y0 = atTop ? 0 : h - band;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y0 + band; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      r += data[p]; g += data[p + 1]; b += data[p + 2]; n++;
    }
  }
  if (!n) return null;
  return 'rgb(' + Math.round(r / n) + ',' + Math.round(g / n) + ',' + Math.round(b / n) + ')';
}

/** Smallest contiguous run of `arr` holding `share` of its total. */
function band(arr, share) {
  let total = 0;
  for (let i = 0; i < arr.length; i++) total += arr[i];
  if (total <= 0) return { lo: 0, hi: arr.length - 1, centre: 0.5, extent: 1 };
  const want = total * share;
  let lo = 0, hi = arr.length - 1, sum = total;
  let bestLo = 0, bestHi = arr.length - 1, bestLen = arr.length;
  // Shrink from whichever end is cheaper while the run still holds `want`.
  while (lo < hi) {
    const dropLo = arr[lo], dropHi = arr[hi];
    const takeLo = dropLo <= dropHi;
    const next = sum - (takeLo ? dropLo : dropHi);
    if (next < want) break;
    if (takeLo) lo++; else hi--;
    sum = next;
    if (hi - lo + 1 < bestLen) { bestLen = hi - lo + 1; bestLo = lo; bestHi = hi; }
  }
  const n = arr.length;
  // Energy-weighted centre within the band reads better than its midpoint when
  // the subject sits off to one side of it.
  let wsum = 0, acc = 0;
  for (let i = bestLo; i <= bestHi; i++) { wsum += arr[i]; acc += arr[i] * (i + 0.5); }
  return {
    lo: bestLo / n,
    hi: (bestHi + 1) / n,
    centre: wsum > 0 ? (acc / wsum) / n : (bestLo + bestHi + 1) / (2 * n),
    extent: bestLen / n
  };
}

/**
 * Work out object-position (and an optional modest zoom) for a cover photo.
 *
 * box   — { w, h } of the page window, any consistent unit
 * safe  — { top, bottom } fractions of page height that other furniture covers
 *         (masthead, teaser strip); the subject is aimed between them
 * zoom  — largest scale-up allowed past `cover`; 1 disables it
 */
export async function frameCover(url, box, safe, zoom) {
  const maxZoom = Math.max(1, zoom == null ? 1.2 : zoom);
  const top = (safe && safe.top) || 0;
  const bottom = (safe && safe.bottom) != null ? safe.bottom : 1;
  // Unmeasurable or not, the photograph still starts below the masthead.
  const fallback = {
    objectPosition: '50% 50%',
    scale: 1,
    box: {
      width: '100%',
      height: ((1 - top) * 100).toFixed(3) + '%',
      left: '0%',
      top: (top * 100).toFixed(3) + '%'
    },
    fill: null,
    note: 'centred below the masthead — the picture could not be measured'
  };

  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('cover did not load'));
    i.src = url;
  }).catch(() => null);
  if (!img || !img.naturalWidth) return fallback;

  const iw = img.naturalWidth, ih = img.naturalHeight;
  let rows, cols, keepRows, keepCols, heroCols, skyFill, subjectTop;
  try {
    const s = SAMPLE / Math.max(iw, ih);
    const w = Math.max(8, Math.round(iw * s)), h = Math.max(8, Math.round(ih * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    // Opened over file:// the canvas is tainted and this throws; the fallback
    // framing is then the honest answer.
    const px = ctx.getImageData(0, 0, w, h).data;
    const e = energy(px, w, h);
    rows = band(e.rows, SHARE);
    cols = band(e.cols, SHARE);
    // The tight band finds where to aim; a wider one says what must not be cut.
    // Without it a centroid sitting left of a long subject — a horse standing
    // side-on — pulls the crop across its hindquarters.
    keepRows = band(e.rows, KEEP);
    keepCols = band(e.cols, KEEP);
    subjectTop = onset(e.rows);
    // Across the page, measured on the subject's own rows rather than the
    // whole frame — see colsIn above.
    const hLo = Math.min(subjectTop == null ? rows.lo : subjectTop, rows.lo);
    heroCols = band(colsIn(px, w, h, Math.round(hLo * h), Math.round(rows.hi * h)), HERO);
    skyFill = edgeColour(px, w, h, true);
  } catch (err) {
    return Object.assign({}, fallback, { note: 'centred — the picture could not be read (' + (err.message || err) + ')' });
  }

  // The photograph starts at the foot of the masthead, not at the head of the
  // page, and runs to the page foot.
  //
  // Framing it across the whole page and trusting a measurement to keep the
  // subject out of the header does not hold. Where the crop is driven by the
  // height there is no vertical overflow left to slide at all, and where there
  // is overflow the amount to slide has to be solved from a reading of where
  // the subject's leading edge sits — a reading two editions got wrong, both
  // times printing the horse's head under the wordmark.
  //
  // Inset, the question cannot arise: whatever the picture holds and however
  // it is measured, none of it reaches the header. The strip above is painted
  // in a colour sampled from the picture's own top edge, so the sky reads as
  // continuous behind the wordmark, and the measurement is left to do the
  // thing it is good at — placing the subject inside the space that is free.
  const clear = Math.max(0.2, bottom - top);
  const baseW = box.w, baseH = box.h - top * box.h;
  // What the furniture leaves: masthead foot down to the head of the teaser.
  const clearDepth = Math.min(baseH, (bottom - top) * box.h);
  const base = Math.max(baseW / iw, baseH / ih);
  // The hero runs from the subject's leading edge — the jockey's cap, the
  // first row carrying detail — to the foot of the interest band. Sizing off
  // the interest band alone measures the horse from the shoulder down, and a
  // frame given deliberate headroom then prints as mostly sky.
  const heroLo = Math.min(subjectTop == null ? rows.lo : subjectTop, rows.lo);
  const heroDepth = Math.max(0, rows.hi - heroLo);
  let z = 1;
  if (maxZoom > 1 && heroDepth > 0.02 && heroDepth < 0.92) {
    // Fill most of the clear depth with the hero, leaving a little air under
    // the masthead and above the teaser strip.
    const want = (FILL * clear * box.h) / (heroDepth * ih * base);
    // What the width will pay for. The measure is the hero's own span across
    // the frame, not the wider keep-band — that band takes in the grandstand
    // and the trailing field, which the crop is allowed to lose, and reading
    // the limit off it holds the enlargement to a few per cent.
    const across = heroCols && heroCols.extent > 0 ? heroCols.extent
      : (cols.extent > 0 ? cols.extent : keepCols.extent);
    const fitsAcross = across > 0 ? (ACROSS * baseW) / (across * iw * base) : maxZoom;
    z = Math.min(maxZoom, Math.max(1, Math.min(want, fitsAcross)));
    // The hero's foot still has to clear the teaser strip, and with the
    // picture's foot on the page foot only a larger picture opens that gap:
    // what lies below the hero in the frame is all that separates the hooves
    // from the strip, and enlarging scales it. Where the width cap and the
    // teaser disagree the teaser wins — an inch lost off the sides is
    // ordinary for a cover, a horse standing on the teaser strip is not.
    const below = Math.max(0.01, 1 - rows.hi);
    const zClear = (baseH - clearDepth + AIR) / (below * ih * base);
    if (zClear > z) z = Math.min(maxZoom, zClear);
  }
  // The photograph fills the window it is given — masthead foot to page foot,
  // edge to edge. Printing it under size instead only opens a band of flat
  // sampled colour under the wordmark, which reads as a mistake however
  // faithfully the colour is matched.
  const fit = base * z;
  const fw = iw * fit, fh = ih * fit;
  // The element is given the photograph's own printed size, which is at least
  // as large as the window on both axes, and slid under it; the page's own
  // overflow does the cropping. Sizing the element to the window instead and
  // leaning on object-position cannot work: `cover` recomputes its own fit
  // inside whatever box it is handed, so an enlargement expressed that way is
  // silently discarded and the picture prints at plain cover scale.
  const overX = Math.max(0, fw - baseW), overY = Math.max(0, fh - baseH);
  // The clear depth, in coordinates down from the window's own top edge.
  const safeLo = 0, safeHi = clearDepth;
  const place = (centre, keep, scaled, over, target, lo, hi) => {
    if (over <= 0.5) return 50;                       // no crop on this axis
    let p = ((centre * scaled) - target) / over * 100;
    // Hold the keep-band inside the clear part of the box if it will fit: its
    // low edge clear of the head, its high edge above the teaser strip.
    const pMax = ((keep.lo * scaled) - lo) / over * 100;
    const pMin = ((keep.hi * scaled) - hi) / over * 100;
    if (pMin <= pMax) p = Math.max(pMin, Math.min(pMax, p));
    return Math.max(0, Math.min(100, p));
  };
  // Across the page the hero band is centred, then held inside the window if
  // it will fit. Aiming the whole frame's centroid instead put the horse's
  // hindquarters over the page edge, because the grandstand it takes in pulls
  // the centroid left.
  const hx = heroCols && heroCols.extent > 0 ? heroCols : cols;
  let slidX = Math.max(0, Math.min(overX, hx.centre * fw - baseW / 2));
  const xLo = hx.lo * fw, xHi = hx.hi * fw;
  if (xHi - xLo <= baseW) slidX = Math.max(xHi - baseW, Math.min(xLo, slidX));
  slidX = Math.max(0, Math.min(overX, slidX));
  const px = overX > 0.5 ? (slidX / overX) * 100 : 50;
  // Down the page the hero is centred in the clear space rather than aimed by
  // its energy centroid. The centroid sits wherever the detail happens to be
  // heaviest — the crowd, the grandstand glass — and the wider keep-band then
  // drags the crop to one limit or the other, which is how the hero came to
  // print two points off the teaser strip with a third of the page in sky.
  // Sliding is measured in points of the picture, upwards: a larger slide
  // lifts the hero towards the masthead.
  const heroMid = ((heroLo + rows.hi) / 2) * fh;
  let slid = Math.max(0, Math.min(overY, heroMid - (safeLo + safeHi) / 2));
  // Then hold a little air at both ends, as far as the overflow allows.
  const upTo = Math.min(overY, heroLo * fh - AIR);
  const from = Math.max(0, rows.hi * fh - (safeHi - AIR));
  if (from <= upTo) slid = Math.max(from, Math.min(upTo, slid));
  const py = overY > 0.5 ? (slid / overY) * 100 : 50;
  const heroTop = heroLo * fh - slid, heroFoot = rows.hi * fh - slid;


  return {
    objectPosition: '50% 50%',
    scale: z,
    box: {
      width: (fw / box.w * 100).toFixed(3) + '%',
      height: (fh / box.h * 100).toFixed(3) + '%',
      left: (-(px / 100) * overX / box.w * 100).toFixed(3) + '%',
      top: ((top * box.h - slid) / box.h * 100).toFixed(3) + '%'
    },
    // Painted behind the photograph, so the strip it leaves at the head of the
    // page carries on from the picture's own sky.
    fill: skyFill || null,
    note: 'subject from ' + Math.round(subjectTop * 100) + '% down, interest band '
      + Math.round(rows.lo * 100) + '\u2013' + Math.round(rows.hi * 100)
      + '%, centred at ' + Math.round(cols.centre * 100) + '% across; filling the page from the masthead foot down'
      + (z > 1.001 ? ', the hero enlarged ' + Math.round((z - 1) * 100) + '%' : '')
      + '. Hero set ' + Math.round(heroTop) + 'pt below the masthead, '
      + Math.round(safeHi - heroFoot) + 'pt clear of the teaser strip'
      + (heroFoot > safeHi + 2 ? ' — it runs under the teaser strip; the picture needs depth cropped off its foot.' : '')
  };
}
