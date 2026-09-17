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
  let rows, cols, keepRows, keepCols;
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
  } catch (err) {
    return Object.assign({}, fallback, { note: 'centred — the picture could not be read (' + (err.message || err) + ')' });
  }

  // `cover` scale, then any zoom that helps fill the clear band with subject.
  const base = Math.max(box.w / iw, box.h / ih);
  const clear = Math.max(0.2, bottom - top);
  let scale = base;
  if (maxZoom > 1 && rows.extent > 0) {
    // Aim the subject band at ~80% of the clear band's depth.
    const want = (0.8 * clear * box.h) / (rows.extent * ih * base);
    // ...but never zoom so far that the wider keep-band no longer fits across.
    const fitsAcross = keepCols.extent > 0 ? box.w / (keepCols.extent * iw * base) : maxZoom;
    scale = base * Math.min(maxZoom, Math.max(1, Math.min(want, fitsAcross)));
  }

  const z = scale / base;
  // Zoom grows the element past the page and centres the overflow rather than
  // using a transform: `cover` then scales to base x z on its own, and the
  // object-position below is solved against that same geometry.
  const bw = box.w * z, bh = box.h * z;
  const offX = -(bw - box.w) / 2, offY = -(bh - box.h) / 2;
  const sw = iw * scale, sh = ih * scale;
  const overX = sw - bw, overY = sh - bh;
  const place = (centre, keep, scaled, over, target, offset, size) => {
    if (over <= 0.5) return 50;                       // no crop on this axis
    let p = ((centre * scaled) - (target * size - offset)) / over * 100;
    // Hold the keep-band inside the window if it will fit: the low edge must
    // not fall off the near side, nor the high edge off the far side.
    const pMax = ((keep.lo * scaled) + offset) / over * 100;
    const pMin = ((keep.hi * scaled) + offset - size) / over * 100;
    if (pMin <= pMax) p = Math.max(pMin, Math.min(pMax, p));
    return Math.max(0, Math.min(100, p));
  };
  const px = place(cols.centre, keepCols, sw, overX, 0.5, offX, box.w);
  const py = place(rows.centre, keepRows, sh, overY, (top + bottom) / 2, offY, box.h);

  return {
    objectPosition: Math.round(px) + '% ' + Math.round(py) + '%',
    scale: z,
    box: {
      width: (z * 100).toFixed(3) + '%',
      height: (z * 100).toFixed(3) + '%',
      left: (-(z - 1) * 50).toFixed(3) + '%',
      top: (-(z - 1) * 50).toFixed(3) + '%'
    },
    note: 'subject measured across ' + Math.round(rows.lo * 100) + '\u2013' + Math.round(rows.hi * 100)
      + '% of the height, centred at ' + Math.round(cols.centre * 100) + '% across'
  };
}
