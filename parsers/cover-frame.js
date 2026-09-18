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
const MIN_FIT = 0.84;   // smallest a photo may print before it looks inset
const EDGE = 0.03;      // share of the height averaged for the fill colour
const ONSET = 0.5;      // share of mean row energy that counts as subject

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
  const fallback = {
    objectPosition: '50% ' + Math.round(((top + bottom) / 2) * 100) + '%',
    scale: 1,
    box: { width: '100%', height: '100%', left: '0%', top: '0%' },
    fill: null,
    note: 'centred — the picture could not be measured'
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

  // `cover` scale, then a correction — which way it goes depends on the shape
  // of the picture, because the two shapes fail differently.
  const byW = box.w / iw, byH = box.h / ih;
  const base = Math.max(byW, byH);
  const clear = Math.max(0.2, bottom - top);
  let scale = base, deep = false, short = false;

  if (byH >= byW) {
    // Portrait, deeper than the page in proportion. `cover` is driven by the
    // height, so the whole height is already on the page: there is no vertical
    // overflow left to slide, and the subject prints wherever the camera put
    // it — in October's frame, the horse's head behind the masthead. Enlarging
    // only makes the collision worse.
    //
    // So print it a little smaller and sit it on the page foot. The subject
    // drops clear of the masthead, the photograph's own sky runs up behind the
    // wordmark, and the grass still reaches the teaser strip. The width pays
    // for it: `cover` crops that much off the sides, so the picture can lose
    // the same amount before a gap opens beside it.
    //
    // The reduction is solved, not chosen: sat on the foot at z, the subject's
    // leading edge lands at (1 - z) + subjectTop * z, and clearing the
    // masthead means putting that at `top`.
    const zMin = Math.max(MIN_FIT, byW / base);
    const want = subjectTop < 1 ? (1 - top) / (1 - subjectTop) : 1;
    scale = base * Math.max(zMin, Math.min(1, want));
    deep = true;
    short = want < zMin - 0.001;   // the width could not pay for all of it
  } else if (maxZoom > 1 && rows.extent > 0) {
    // Landscape, shallower than the page: the height is the scarce axis, so a
    // modest enlargement is what fills the clear band with subject.
    const want = (0.8 * clear * box.h) / (rows.extent * ih * base);
    // ...but never zoom so far that the wider keep-band no longer fits across.
    const fitsAcross = keepCols.extent > 0 ? box.w / (keepCols.extent * iw * base) : maxZoom;
    scale = base * Math.min(maxZoom, Math.max(1, Math.min(want, fitsAcross)));
  }

  const z = scale / base;
  // The element takes the scaled size rather than a transform, so `cover`
  // resolves to base x z on its own and the object-position below is solved
  // against the same geometry. An enlargement centres its overflow; a reduced
  // portrait keeps its full width — that is the whole point, it is the width
  // that was paying for the reduction — and loses the depth off the top, which
  // is what lowers the subject.
  const shrunk = deep && z < 0.999;
  const bw = shrunk ? box.w : box.w * z, bh = box.h * z;
  const offX = shrunk ? 0 : -(bw - box.w) / 2;
  const offY = shrunk ? box.h - bh : -(bh - box.h) / 2;
  // A reduced portrait is scaled to the box by `cover` on its own terms, so
  // its own geometry — not the nominal one — decides what is left to crop.
  // Reduced, it fits the box exactly: nothing is cropped and both axes centre.
  const fit = shrunk ? Math.max(bw / iw, bh / ih) : scale;
  const fw = iw * fit, fh = ih * fit;
  const overX = fw - bw, overY = fh - bh;
  const place = (centre, keep, scaled, over, target, offset, size, lo, hi) => {
    if (over <= 0.5) return 50;                       // no crop on this axis
    let p = ((centre * scaled) - (target * size - offset)) / over * 100;
    // Hold the keep-band inside the clear part of the window if it will fit:
    // its low edge must not fall behind the masthead, nor its high edge under
    // the teaser strip.
    const pMax = ((keep.lo * scaled) + offset - lo) / over * 100;
    const pMin = ((keep.hi * scaled) + offset - hi) / over * 100;
    if (pMin <= pMax) p = Math.max(pMin, Math.min(pMax, p));
    return Math.max(0, Math.min(100, p));
  };
  const px = place(cols.centre, keepCols, fw, overX, 0.5, offX, box.w, 0, box.w);
  const py = place(rows.centre, keepRows, fh, overY, (top + bottom) / 2, offY, box.h,
    top * box.h, bottom * box.h);

  return {
    objectPosition: Math.round(px) + '% ' + Math.round(py) + '%',
    scale: z,
    box: {
      width: (bw / box.w * 100).toFixed(3) + '%',
      height: (bh / box.h * 100).toFixed(3) + '%',
      left: (offX / box.w * 100).toFixed(3) + '%',
      top: (offY / box.h * 100).toFixed(3) + '%'
    },
    // Painted behind the photograph, so the strip a reduced portrait leaves at
    // the head of the page carries on from the picture's own sky.
    fill: skyFill || null,
    note: 'subject from ' + Math.round(subjectTop * 100) + '% down, interest band '
      + Math.round(rows.lo * 100) + '\u2013' + Math.round(rows.hi * 100)
      + '%, centred at ' + Math.round(cols.centre * 100) + '% across'
      + (z < 0.999 ? '; printed at ' + Math.round(z * 100) + '% and sat on the page foot to clear the masthead' : '')
      + (short ? '. The width would not pay for the whole reduction — the subject still runs behind the masthead. Crop some depth off the top of the photograph.' : '')
  };
}
