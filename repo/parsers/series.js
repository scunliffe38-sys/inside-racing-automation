// Victorian Race Series (page 51) — reads the race series Word document.
//
// Source: inputs/Race Series.docx. The document is a run of blocks, each a
// heading paragraph followed by one table:
//   four columns  Heat | Venue | Date | Race   (a series and its heats)
//   three columns Date | Venue | Race          (the highweight schedule)
// Where a heading carries trailing explanatory text after a run of spaces, that
// tail is printed as a note under the block's table.

import { unzip } from './xlsx.js';

const unescapeXml = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#x?([0-9a-fA-F]+);/g, (m, c) => String.fromCharCode(/^&#x/i.test(m) ? parseInt(c, 16) : +c))
  .replace(/&amp;/g, '&');

// only <w:t> and <w:t ...>, never <w:tc>, <w:tcW>, <w:top>
const runsOf = xml => unescapeXml(
  [...String(xml).matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('')
);
// headings keep their internal spacing, because a run of spaces is what separates
// a title from its explanatory tail
const headingOf = xml => runsOf(xml).replace(/[\r\n\t]+/g, ' ').trim();
const textOf = xml => runsOf(xml).replace(/\s+/g, ' ').trim();

export async function loadSeries(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('cannot read ' + url + ' (' + res.status + ')');
  const files = await unzip(await res.blob());
  if (!files['word/document.xml']) throw new Error(url + ' is not a Word document');
  const xml = new TextDecoder().decode(files['word/document.xml']);
  const body = (xml.match(/<w:body>([\s\S]*)<\/w:body>/) || [])[1] || '';
  const warnings = [];

  const nodes = [...body.matchAll(/<w:(p|tbl)\b[\s\S]*?<\/w:\1>/g)].map(m => ({ kind: m[1], xml: m[0] }));
  const blocks = [];
  let pending = null;

  nodes.forEach(n => {
    if (n.kind === 'p') {
      const t = headingOf(n.xml);
      if (!t) return;
      if (pending) warnings.push('"' + pending.title + '" has a heading but no table.');
      // a heading may carry an explanatory tail after a run of spaces
      const split = t.match(/^(.*?)\s{3,}(.*)$/);
      pending = { title: split ? split[1].trim() : t, note: split ? split[2].trim() : '' };
      return;
    }
    const rows = [...n.xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)]
      .map(r => [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>|<w:tc\s[^>]*>[\s\S]*?<\/w:tc>/g)].map(c => textOf(c[0])))
      .filter(cells => cells.some(c => c));
    if (!rows.length) { warnings.push('Empty table' + (pending ? ' under "' + pending.title + '"' : '') + '.'); pending = null; return; }
    if (!pending) { warnings.push('Table with no heading above it — skipped.'); return; }

    // the first row is the column headings when it names them
    const first = rows[0].map(c => c.toLowerCase());
    const hasHead = first[0] === 'heat' || first[0] === 'date';
    const columns = (hasHead ? rows[0] : (rows[0].length === 3 ? ['Date', 'Venue', 'Race'] : ['Heat', 'Venue', 'Date', 'Race'])).map(c => c.toUpperCase());
    if (!hasHead) warnings.push('"' + pending.title + '" has no heading row — assuming ' + columns.join(' / ') + '.');

    const data = (hasHead ? rows.slice(1) : rows).filter(r => r.some(c => c));
    data.forEach((r, i) => {
      if (r.length !== columns.length) {
        warnings.push('"' + pending.title + '" row ' + (i + 1) + ' has ' + r.length + ' cells, expected ' + columns.length + '.');
      }
      const blank = columns.map((c, k) => (r[k] ? null : c)).filter(Boolean);
      if (blank.length) warnings.push('"' + pending.title + '" row ' + (i + 1) + ' is missing ' + blank.join(', ') + '.');
    });
    if (!data.length) warnings.push('"' + pending.title + '" has no rows.');

    blocks.push({ title: pending.title, note: pending.note, columns, rows: data });
    pending = null;
  });

  if (pending) warnings.push('"' + pending.title + '" has a heading but no table.');
  if (!blocks.length) warnings.push('No series found in ' + url);

  // Two columns of 718pt on the opening page. The page itself does the real
  // packing; this only says how many pages the section will take, so the
  // producer knows before opening it.
  const depth = blocks.reduce((total, b) => {
    const note = b.note ? 6.7 + Math.max(1, Math.ceil(String(b.note).length / 62)) * 9.05 + 6.2 : 0;
    return total + 34 + 14.2 + note + 14.7 + (b.rows || []).length * 14.2;
  }, 0);
  const pages = Math.max(1, Math.ceil(depth / (718 * 2)));
  if (pages > 1) {
    warnings.push(blocks.length + ' blocks, about ' + Math.round(depth) + 'pt of tables \u2014 the section runs to ' + pages + ' pages.');
  }

  return { blocks, warnings, count: blocks.length, depth, pages };
}
