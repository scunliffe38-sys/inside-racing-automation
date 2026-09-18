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
const OUT = 0.875;      // printed depth as a share of the clear space: the
                        // photograph sits a touch under full size so more of
                        // the subject is in frame, as far as the width allows

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
  let rows, cols, keepRows, keepCols, skyFill, subjectTop;
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
  const base = Math.max(baseW / iw, baseH / ih);
  let z = 1;
  if (maxZoom > 1 && rows.extent > 0 && rows.extent < 0.55) {
    // A subject occupying only a shallow band of the frame is enlarged to fill
    // the clear depth, so long as the wider keep-band still fits across.
    const want = (0.8 * clear * box.h) / (rows.extent * ih * base);
    const fitsAcross = keepCols.extent > 0 ? baseW / (keepCols.extent * iw * base) : maxZoom;
    z = Math.min(maxZoom, Math.max(1, Math.min(want, fitsAcross)));
  }
  // A subject filling the frame is printed a little under the clear depth
  // instead, so more of it is in frame — a horse whose legs the crop was
  // taking. The width sets how far that can go: the picture still has to reach
  // both edges of the page, so a frame barely wider than the page pays for
  // little of the reduction and a wide one pays for all of it.
  const fit = z > 1.001 ? base * z : Math.max(baseW / iw, (baseH / ih) * OUT);
  const fw = iw * fit, fh = ih * fit;
  // The box IS the photograph's own size, sat on the page foot. Nothing is
  // cropped by `cover` inside it; the page's own overflow takes whatever runs
  // past the sides, and the strip left at the head carries the sampled sky.
  const bw = Math.min(baseW, fw), bh = Math.min(baseH, fh);
  const offY = top * box.h + Math.max(0, baseH - fh);
  const offX = fw > baseW ? 0 : (baseW - fw) / 2;
  const safeLo = 0, safeHi = Math.min(bh, bottom * box.h - offY);
  const overX = fw - bw, overY = fh - bh;
  // Positions are in box coordinates: `target`, `lo` and `hi` are lengths down
  // from the box's own top edge, not the page's.
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
  const px = place(cols.centre, keepCols, fw, overX, bw / 2, 0, bw);
  const py = place(rows.centre, keepRows, fh, overY, (safeLo + safeHi) / 2, safeLo, safeHi);
  const printed = fh / baseH;

  return {
    objectPosition: Math.round(px) + '% ' + Math.round(py) + '%',
    scale: z,
    box: {
      width: (Math.max(bw, Math.min(fw, box.w)) / box.w * 100).toFixed(3) + '%',
      height: (bh / box.h * 100).toFixed(3) + '%',
      left: (offX / box.w * 100).toFixed(3) + '%',
      top: (offY / box.h * 100).toFixed(3) + '%'
    },
    // Painted behind the photograph, so the strip it leaves at the head of the
    // page carries on from the picture's own sky.
    fill: skyFill || null,
    note: 'subject from ' + Math.round(subjectTop * 100) + '% down, interest band '
      + Math.round(rows.lo * 100) + '\u2013' + Math.round(rows.hi * 100)
      + '%, centred at ' + Math.round(cols.centre * 100) + '% across; set below the masthead at '
      + Math.round(printed * 100) + '% of the clear depth'
      + (z > 1.001 ? ', enlarged ' + Math.round((z - 1) * 100) + '% to fill it' : '')
      + (printed > 0.995 && z <= 1.001 ? ' \u2014 the width would not pay for a reduction, so the frame is full depth' : '')
  };
}
