// Shared reader for the tab-separated exports. They come out of the reporting
// tool as UTF-16LE with a byte-order mark, which a plain fetch().text() mangles,
// so decode from the raw bytes and sniff the encoding from the BOM.

export async function fetchDelimited(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('cannot read ' + url + ' (' + res.status + ')');
  const buf = new Uint8Array(await res.arrayBuffer());
  let encoding = 'utf-8';
  let offset = 0;
  if (buf[0] === 0xff && buf[1] === 0xfe) { encoding = 'utf-16le'; offset = 2; }
  else if (buf[0] === 0xfe && buf[1] === 0xff) { encoding = 'utf-16be'; offset = 2; }
  else if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) { offset = 3; }
  const text = new TextDecoder(encoding).decode(buf.subarray(offset));
  return { text, encoding };
}

/**
 * Most of these files are tab separated, but a few arrive from a spreadsheet as
 * true comma-separated values. Decide from the header line: tabs win when there
 * are any, since a tab-separated cell may legitimately contain a comma.
 */
function delimiter(line) {
  return String(line || '').indexOf('\t') >= 0 ? '\t' : ',';
}

/** Split one line, honouring "quoted, cells" when the file uses commas. */
function cells(line, d) {
  const s = String(line || '');
  if (d === '\t' || s.indexOf('"') < 0) return s.split(d);
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === d) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Splits the text into row objects keyed by the header row's own column names.
 * Trailing empty columns from the export are ignored.
 */
export function rows(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (!lines.length) return { head: [], body: [] };
  const d = delimiter(lines[0]);
  const head = cells(lines[0], d).map(h => h.trim());
  const body = lines.slice(1).map(l => {
    const cs = cells(l, d);
    const o = {};
    head.forEach((h, i) => { if (h) o[h] = (cs[i] || '').trim(); });
    return o;
  });
  return { head, body };
}

// the exports mark a line break inside a cell as \sYYY\s
export const LINE_BREAK = /\\s\s*YYY\s*\\s/g;

export const splitLines = v => String(v || '').split(LINE_BREAK).map(s => s.trim()).filter(Boolean);

/**
 * Same rows, but keyed by column letter (A, B, C …) so a parser written against
 * the .xlsx layout can read a .csv export of the same schema unchanged. The
 * header row is returned as row 0, exactly as readSheet() gives it.
 */
export function letterRows(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  const letter = i => {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  };
  const d = delimiter(lines[0]);
  return lines.map(l => {
    const o = {};
    cells(l, d).forEach((c, i) => { o[letter(i)] = (c || '').trim(); });
    return o;
  });
}
