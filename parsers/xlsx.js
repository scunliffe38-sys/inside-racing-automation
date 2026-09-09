// Minimal .xlsx reader — no dependencies. Uses DecompressionStream for the zip
// members, then pulls cell values out of the sheet XML.

async function inflate(bytes, method) {
  if (method === 0) return bytes;
  const ds = new DecompressionStream('deflate-raw');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

// Reads the zip central directory and returns { name: Uint8Array }
export async function unzip(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = dv.getUint16(lho + 26, true);
    const lExtraLen = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lNameLen + lExtraLen;
    out[name] = await inflate(buf.subarray(start, start + csize), method);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const unescapeXml = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#10;/g, '\n')
  .replace(/&#x?([0-9a-fA-F]+);/g, (m, c) => String.fromCharCode(/^x/i.test(m.slice(2)) ? parseInt(c, 16) : +c))
  .replace(/&amp;/g, '&');


const CELL = /<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g;

// one cell tag -> { ref, type, body }
function parseCell(tag) {
  const open = tag.match(/^<c\b([^>]*?)(\/?)>/);
  const attrs = open ? open[1] : '';
  const selfClosing = !!(open && open[2]);
  return {
    ref: (attrs.match(/r="([A-Z]+\d+)"/) || [])[1] || '',
    type: (attrs.match(/t="([^"]+)"/) || [])[1] || '',
    body: selfClosing ? '' : tag.slice(open[0].length, -4)
  };
}

// "AB12" -> "AB"
const colOf = ref => ref.replace(/\d+/g, '');

/**
 * Reads the first worksheet of an .xlsx and returns rows as objects keyed by
 * column letter: [{ A: "Bates, Logan", B: "52", ... }, ...] in sheet order.
 * Values are strings; date cells come back as Excel serial numbers.
 */
export async function readSheet(blob) {
  const files = await unzip(blob);
  const dec = new TextDecoder();
  const text = name => (files[name] ? dec.decode(files[name]) : '');

  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => unescapeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
  files.__shared = shared;

  const sheetName = Object.keys(files).find(n => /^xl\/worksheets\/sheet1\.xml$/.test(n))
    || Object.keys(files).find(n => /^xl\/worksheets\/.+\.xml$/.test(n));
  const sheet = text(sheetName);

  const rows = [];
  for (const m of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const tag of m[1].match(CELL) || []) {
      const c = parseCell(tag);
      if (!c.ref) continue;
      const inline = (c.body.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
      const v = (c.body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let value = '';
      if (inline !== undefined) value = unescapeXml(inline);
      else if (c.type === 's') value = shared[+v] ?? '';
      else if (v !== undefined) value = unescapeXml(v);
      cells[colOf(c.ref)] = String(value).trim();
    }
    if (Object.values(cells).some(v => v !== '')) rows.push(cells);
  }
  return rows;
}

/**
 * Like readSheet, but keeps each cell's rich-text runs so bold, colour and size
 * survive: cells come back as [{ t, b?, c?, s? }, ...]. Plain cells are a single
 * run carrying only its text.
 */
export async function readSheetRich(blob) {
  const files = await unzip(blob);
  const dec = new TextDecoder();
  const text = name => (files[name] ? dec.decode(files[name]) : '');

  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => {
    const body = m[1];
    if (!/<r>/.test(body)) {
      const t = unescapeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
      return t ? [{ t }] : [];
    }
    return [...body.matchAll(/<r>([\s\S]*?)<\/r>/g)].map(r => {
      const props = (r[1].match(/<rPr>([\s\S]*?)<\/rPr>/) || [])[1] || '';
      const run = { t: unescapeXml((r[1].match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '') };
      if (/<b\s*\/?>/.test(props)) run.b = 1;
      const rgb = (props.match(/<color[^>]*rgb="([0-9A-Fa-f]{6,8})"/) || [])[1];
      if (rgb) run.c = '#' + rgb.slice(-6).toUpperCase();
      const sz = (props.match(/<sz[^>]*val="([\d.]+)"/) || [])[1];
      if (sz) run.s = Number(sz);
      return run;
    }).filter(r => r.t !== '');
  });

  const sheetName = Object.keys(files).find(n => /^xl\/worksheets\/sheet1\.xml$/.test(n))
    || Object.keys(files).find(n => /^xl\/worksheets\/.+\.xml$/.test(n));
  const sheet = text(sheetName);

  const out = [];
  for (const m of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const tag of m[1].match(CELL) || []) {
      const c = parseCell(tag);
      if (!c.ref) continue;
      const v = (c.body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (c.type === 's' && v !== undefined) cells[colOf(c.ref)] = shared[+v] || [];
      else if (v !== undefined) cells[colOf(c.ref)] = [{ t: unescapeXml(v) }];
      else cells[colOf(c.ref)] = [];
    }
    out.push(cells);
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Every worksheet in the workbook, as [{ name, rows }] with rows keyed by
 * column letter and carrying __row, their 1-based sheet row. Used where the
 * same shape is kept on several sheets — the picnic program holds one per
 * season — so the caller can read them all and filter by date rather than
 * having to work out which sheet a month belongs to.
 */
export async function readSheets(blob) {
  const files = await unzip(blob);
  const dec = new TextDecoder();
  const text = name => (files[name] ? dec.decode(files[name]) : '');

  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => unescapeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));

  const rels = {};
  for (const m of text('xl/_rels/workbook.xml.rels').matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    rels[m[1]] = m[2].replace(/^\/?xl\//, '').replace(/^\//, '');
  }

  const out = [];
  for (const m of text('xl/workbook.xml').matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = (m[1].match(/name="([^"]+)"/) || [])[1];
    const rid = (m[1].match(/r:id="([^"]+)"/) || [])[1];
    if (!name || !rid) continue;
    const sheet = text('xl/' + (rels[rid] || ''));
    if (!sheet) continue;
    const rows = [];
    for (const r of sheet.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = { __row: Number(r[1]) };
      for (const tag of r[2].match(CELL) || []) {
        const cc = parseCell(tag);
        if (!cc.ref) continue;
        const inline = (cc.body.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
        const v = (cc.body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let value = '';
        if (inline !== undefined) value = unescapeXml(inline);
        else if (cc.type === 's') value = shared[+v] ?? '';
        else if (v !== undefined) value = unescapeXml(v);
        cells[colOf(cc.ref)] = String(value).trim();
      }
      if (Object.keys(cells).length > 1) rows.push(cells);
    }
    out.push({ name: unescapeXml(name), rows });
  }
  return out;
}

/** Excel serial date -> "8-Aug-27" as the printed edition sets it. */
export function excelDate(serial) {
  const n = Number(serial);
  if (!isFinite(n) || n <= 0) return String(serial || '').trim();
  const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return d.getUTCDate() + '-' + MONTHS[d.getUTCMonth()] + '-' + String(d.getUTCFullYear()).slice(2);
}
