// Notices sections (pages 51 policy, 52, 53, 54) — reads the Word documents that
// Integrity Services, Stewards and Racing Operations supply.
//
//   inputs/Industry Notice.docx          page 52
//   inputs/Stewards Room.docx            page 53
//   inputs/Rules Extracts.docx           page 54
//   inputs/Division of Races Policy.docx page 50, lower half
//
// Block type is carried by the paragraph style, so the documents stay editable
// in Word and nothing depends on how the text is punctuated:
//
//   Heading 1   subject heading (52) / topic heading (53) / rule heading (54)
//   Heading 2   sub-heading inside a topic
//   Normal      body paragraph
//   IR Step     numbered step; numbering is applied by the layout
//   IR Clause   indented sub-clause, its number typed as part of the rule
//   IR Bullet   bulleted policy point
//
// An unstyled paragraph is treated as body copy. A document with no paragraphs
// is a legitimate state — it means no copy was supplied — and the page then
// prints an awaiting-copy panel rather than inventing content.
//
// In practice the copy does not always arrive styled. Integrity Services and
// the Stewards write these documents in Word with the headings simply set bold,
// which leaves the whole document Normal and every topic heading invisible to a
// style test. So a paragraph that is bold end to end, short, and not punctuated
// as a sentence is read as a heading as well, and a warning says the document
// would be safer styled. Judging headings by appearance is a fallback, never a
// replacement: an explicit Heading 1 always wins.

import { unzip } from './xlsx.js';

const unescapeXml = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#x?([0-9a-fA-F]+);/g, (m, c) => String.fromCharCode(/^&#x/i.test(m) ? parseInt(c, 16) : +c))
  .replace(/&amp;/g, '&');

const textOf = xml => unescapeXml(
  [...String(xml).replace(/<w:(?:br|cr)\b[^>]*\/>/g, '<w:t> </w:t>').matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('')
).replace(/\s+/g, ' ').trim();

// The paragraph as printed: runs in order, each carrying its own bold and any
// hyperlink, with Word's line breaks kept (v11 review: the Industry Notice
// sets its two resource links, the contact lines and the sign-off on lines of
// their own, links clickable and bold where the document has it). A link is
// either a <w:hyperlink> resolved through the relationships part or a
// HYPERLINK field; a web address or email typed as plain text is linked too.
const EMAIL_OR_URL = /((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;
function runsOf(pxml, rels) {
  const out = [];
  const add = (t, b, href, f) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && !last.br && last.b === b && last.href === href && last.i === f.i && last.u === f.u) last.t += t;
    else out.push({ t, b, href, i: f.i, u: f.u });
  };
  let fieldHref = null, instr = '', inInstr = false;
  const doRun = (run, href) => {
    const bold = runIsBold(run);
    const f = { i: runIs(run, 'i'), u: runIsUnderlined(run) };
    for (const m of run.matchAll(/<w:fldChar\b[^>]*w:fldCharType="(\w+)"[^>]*\/>|<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(br|cr)\b[^>]*\/>|<w:tab\b[^>]*\/>/g)) {
      if (m[1] === 'begin') { inInstr = true; instr = ''; }
      else if (m[1] === 'separate') { inInstr = false; const u = instr.match(/HYPERLINK\s+"([^"]+)"/i); fieldHref = u ? u[1] : null; }
      else if (m[1] === 'end') { inInstr = false; fieldHref = null; }
      else if (m[2] !== undefined) { if (inInstr) instr += unescapeXml(m[2]); }
      else if (m[3] !== undefined) { if (!inInstr) add(unescapeXml(m[3]), bold, href || fieldHref, f); }
      else if (m[4]) out.push({ br: true });
      else add(' ', bold, href || fieldHref, f);
    }
  };
  const re = /<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>|<w:fldSimple\b([^>]*)>([\s\S]*?)<\/w:fldSimple>|<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  for (const m of String(pxml).matchAll(re)) {
    if (m[1] !== undefined) {
      const id = (m[1].match(/r:id="([^"]+)"/) || [])[1];
      const anchor = (m[1].match(/w:anchor="([^"]+)"/) || [])[1];
      const href = (id && rels[id]) || (anchor ? '#' + anchor : null);
      for (const r of m[2].matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)) doRun(r[0], href);
    } else if (m[3] !== undefined) {
      const u = unescapeXml(m[3]).match(/HYPERLINK\s+"([^"]+)"/i);
      for (const r of m[4].matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)) doRun(r[0], u ? u[1] : null);
    } else doRun(m[0], null);
  }
  // collapse spacing, trim the ends, drop breaks at either end
  out.forEach(p => { if (!p.br) p.t = p.t.replace(/\s+/g, ' '); });
  while (out.length && out[0].br) out.shift();
  while (out.length && out[out.length - 1].br) out.pop();
  if (out.length && !out[0].br) out[0].t = out[0].t.replace(/^\s+/, '');
  if (out.length && !out[out.length - 1].br) out[out.length - 1].t = out[out.length - 1].t.replace(/\s+$/, '');
  out.forEach((p, i) => { if (p.br) { const a = out[i - 1], b = out[i + 1]; if (a && !a.br) a.t = a.t.replace(/\s+$/, ''); if (b && !b.br) b.t = b.t.replace(/^\s+/, ''); } });
  // plain-text addresses become links
  const linked = [];
  out.forEach(p => {
    if (p.br || p.href) { linked.push(p); return; }
    String(p.t).split(EMAIL_OR_URL).forEach((bit, k) => {
      if (!bit) return;
      if (k % 2) linked.push({ t: bit, b: p.b, i: p.i, u: p.u, href: /@/.test(bit) && !/^https?:/i.test(bit) ? 'mailto:' + bit : (/^www\./i.test(bit) ? 'https://' + bit : bit) });
      else linked.push({ t: bit, b: p.b, i: p.i, u: p.u, href: null });
    });
  });
  return linked.filter(p => p.br || p.t);
}

/** The runs in the shape the templates print: one list per kind, so each run
 *  is a plain span, a bold span, a formatted span (italic or underlined, with
 *  or without bold), a link or a line break. */
export const printRuns = runs => (runs || []).map(p => ({
  plain: !p.br && !p.href && !p.b && !p.i && !p.u ? [{ t: p.t }] : [],
  bold: !p.br && !p.href && p.b && !p.i && !p.u ? [{ t: p.t }] : [],
  fmt: !p.br && !p.href && (p.i || p.u) ? [{ t: p.t, w: p.b ? 700 : 400, fs: p.i ? 'italic' : 'normal', td: p.u ? 'underline' : 'none' }] : [],
  link: !p.br && p.href && !p.b ? [{ t: p.t, href: p.href }] : [],
  linkBold: !p.br && p.href && p.b ? [{ t: p.t, href: p.href }] : [],
  br: p.br ? [{}] : []
}));
const debulletRuns = runs => {
  const r = (runs || []).map(p => ({ ...p }));
  if (r.length && !r[0].br) r[0].t = r[0].t.replace(BULLET_GLYPH, '');
  return r;
};

const styleOf = xml => ((String(xml).match(/<w:pStyle\s+w:val="([^"]+)"/) || [])[1] || 'Normal');

// Bold end to end: every run carrying text is bold, either in its own run
// properties or inherited from the paragraph mark. Word writes <w:b/> bare and
// <w:b w:val="0"/> to switch it off again, so both forms have to be read.
const runIsBold = run => {
  const rPr = (String(run).match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
  const b = rPr.match(/<w:b(\s+w:val="([^"]*)")?\s*\/?>/);
  return !!b && !/^(0|false|off)$/i.test(b[2] || '1');
};
// Italic and underline are read the same way; underline is on for any value
// but none.
const runIs = (run, tag) => {
  const rPr = (String(run).match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
  const m = rPr.match(new RegExp('<w:' + tag + '(\\s+w:val="([^"]*)")?\\s*\\/?>'));
  return !!m && !/^(0|false|off)$/i.test(m[2] || '1');
};
const runIsUnderlined = run => {
  const rPr = (String(run).match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
  const m = rPr.match(/<w:u\b(?:[^>]*\sw:val="([^"]*)")?[^>]*\/?>/);
  return !!m && !/^(none|0|false)$/i.test(m[1] || 'single');
};
function allBold(xml) {
  const runs = [...String(xml).matchAll(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)]
    .map(m => m[0])
    .filter(r => /<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/.test(r));
  return runs.length > 0 && runs.every(runIsBold);
}

// A heading the author set by hand rather than by style. Length and punctuation
// keep an emphasised sentence of body copy out: headings are short and are not
// written as sentences.
const HEADINGISH = 90;
const looksLikeHeading = b => b.bold && b.text.length <= HEADINGISH && !/[.:;,]$/.test(b.text.trim());

// How deep the copy runs, in points, from the printed metrics of each paragraph
// style: the gap above it, its line height, and how many characters fit on a
// line at that size. Close enough to page on, and it needs no layout pass — the
// section pages use the same model to break their copy across pages.
const PAGE_DEPTH = 720;      // A4 less the title block and the folio zone

// Characters to the line measured off the printed page: a full-measure line
// at 8pt holds about 158, not the 118 a narrower column would.
// The November review opened the space above a heading by half again.
const NOTICE_METRICS = {
  isSubject: [15, 17, 70], isSubhead: [16.5, 11, 120],
  isStep: [5, 10.4, 150], isClause: [4, 10.4, 152], isBullet: [4, 10.4, 150], isPara: [7, 10.4, 158]
};

// Tightened from the October review: 13pt above every topic and 6pt between
// paragraphs ran the section past one page. The November review opened the
// space above a heading by half again, to 13.5pt. The pages set 13.5pt and
// 5pt, and these figures have to stay the same or the overrun warning misleads.
const STEWARDS_METRICS = {
  isHeading: [13.5, 17, 70], isSubhead: [13.5, 11, 120], isStep: [5, 10.4, 150],
  isClause: [4, 10.4, 152], isBullet: [4, 10.4, 150], isPara: [5, 10.4, 158]
};

function estimate(blocks, metrics) {
  const kinds = Object.keys(metrics);
  return blocks.reduce((total, b) => {
    if (b.isTable) return total + b.depth;
    const kind = kinds.find(k => b[k]) || 'isPara';
    const [gap, lh, cpl] = metrics[kind];
    return total + gap + Math.max(1, Math.ceil(String(b.text || '').length / cpl)) * lh;
  }, 0);
}


// A Word table, kept as a table. Column widths come from the table grid
// (scaled down if wider than the measure), cell shading from the cell, and
// every paragraph in a cell is a line of its own. Depth is estimated the same
// way as body copy so the packer can page it: 8pt on 10.4pt, 3pt padding.
const MEASURE = 549.9;
function tableOf(xml) {
  const grid = [...xml.matchAll(/<w:gridCol\s+w:w="(\d+)"/g)].map(m => +m[1] / 20);
  const rowsXml = [...xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map(m => m[0]);
  const cellRe = /<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g;
  const rows = rowsXml.map(r => [...r.matchAll(cellRe)].map((c, ci) => {
    const span = +((c[0].match(/<w:gridSpan\s+w:val="(\d+)"/) || [])[1] || 1);
    const fill = (c[0].match(/<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6})"/) || [])[1];
    const paras = (c[0].match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || []).filter(p => textOf(p));
    return {
      span,
      fill: fill && !/^FFFFFF$/i.test(fill) ? '#' + fill.toUpperCase() : 'transparent',
      // the left-hand column is the row's label and sets bold (Nov review)
      weight: ci === 0 || (paras.length && paras.every(allBold)) ? 700 : 400,
      // lines after one ending in a colon are its list (Nov review: the races
      // under "3 Hours for Group 1 races on:" print as bullets)
      lines: paras.map(textOf).map((t, i, a) => {
        const isBullet = a.slice(0, i).some(x => /:\s*$/.test(x));
        // the line introducing the list holds 3pt under it
        const isLead = !isBullet && /:\s*$/.test(t) && i < a.length - 1;
        return { t: isBullet ? t.replace(/^[\u2022\u25cf\u25aa\u00b7\u2013-]\s+/, '') : t, isBullet, isLead, isPlain: !isBullet && !isLead };
      })
    };
  }));
  const n = grid.length || Math.max(1, ...rows.map(r => r.reduce((s, c) => s + c.span, 0)));
  let cols = grid.length ? grid : Array(n).fill(MEASURE / n);
  const total = cols.reduce((a, b) => a + b, 0);
  if (total > MEASURE) cols = cols.map(w => w * MEASURE / total);
  let depth = 6 + 1;
  rows.forEach(r => {
    let at = 0, deepest = 1;
    r.forEach(c => {
      const w = cols.slice(at, at + c.span).reduce((a, b) => a + b, 0) || MEASURE / n;
      const cpl = Math.max(8, (w - 10.8) / 3.48);
      deepest = Math.max(deepest, c.lines.reduce((s, l) => s + Math.max(1, Math.ceil(l.t.length / cpl)), 0));
      at += c.span;
    });
    depth += 6 + deepest * 10.4 + 1 + (r.some(c => c.lines.some(l => l.isLead)) ? 3 : 0);
  });
  return {
    isTable: true, style: 'Table', bold: false, text: '',
    width: cols.reduce((a, b) => a + b, 0).toFixed(1) + 'pt',
    cols: cols.map(w => w.toFixed(1) + 'pt').join(' '),
    cells: [].concat(...rows.map(r => r.map(c => ({ fill: c.fill, weight: c.weight, lines: c.lines, gridColumn: 'span ' + c.span })))),
    rows: rows.length, depth
  };
}

// Word's own lists. A paragraph in a list carries <w:numPr> (numId, ilvl);
// numbering.xml says whether that level is a bullet or a number and how the
// number is written ("%1.", "(%2)"). Counters run per list and reset the
// deeper levels when a shallower one advances, as Word does. Returns a
// function from paragraph XML to { kind: 'bullet'|'number', label, level }.
function listNumbering(nxml) {
  const abs = {}, num = {};
  for (const a of nxml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const lv = {};
    for (const l of a[2].matchAll(/<w:lvl\b[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)) {
      lv[l[1]] = {
        fmt: (l[2].match(/<w:numFmt\s+w:val="([^"]+)"/) || [])[1] || 'decimal',
        text: unescapeXml((l[2].match(/<w:lvlText\s+w:val="([^"]*)"/) || [])[1] || '%' + (+l[1] + 1) + '.'),
        start: +((l[2].match(/<w:start\s+w:val="(\d+)"/) || [])[1] || 1)
      };
    }
    abs[a[1]] = lv;
  }
  for (const n of nxml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g)) {
    num[n[1]] = (n[2].match(/<w:abstractNumId\s+w:val="(\d+)"/) || [])[1];
  }
  const roman = n => { let r = '', v = n; [[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],[50,'l'],[40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']].forEach(([k, s]) => { while (v >= k) { r += s; v -= k; } }); return r; };
  const letter = n => { let r = ''; while (n > 0) { n--; r = String.fromCharCode(97 + (n % 26)) + r; n = Math.floor(n / 26); } return r; };
  const show = (n, fmt) => fmt === 'lowerLetter' ? letter(n) : fmt === 'upperLetter' ? letter(n).toUpperCase()
    : fmt === 'lowerRoman' ? roman(n) : fmt === 'upperRoman' ? roman(n).toUpperCase() : String(n);
  const counters = {};
  return pxml => {
    const pr = (String(pxml).match(/<w:numPr>([\s\S]*?)<\/w:numPr>/) || [])[1];
    if (!pr) return null;
    const id = (pr.match(/<w:numId\s+w:val="(\d+)"/) || [])[1];
    const lvl = +((pr.match(/<w:ilvl\s+w:val="(\d+)"/) || [])[1] || 0);
    if (!id || id === '0') return null;
    const def = (abs[num[id]] || {})[lvl] || { fmt: 'bullet', text: '', start: 1 };
    if (def.fmt === 'bullet' || def.fmt === 'none') return { kind: 'bullet', label: '', level: lvl };
    const key = num[id] || id;
    const c = counters[key] = counters[key] || [];
    const lv = (abs[num[id]] || {});
    c[lvl] = c[lvl] == null ? def.start : c[lvl] + 1;
    c.length = lvl + 1;
    const label = def.text.replace(/%(\d)/g, (m, k) => {
      const i = +k - 1, d = lv[i] || { fmt: 'decimal', start: 1 };
      return show(c[i] == null ? d.start : c[i], d.fmt);
    });
    return { kind: 'number', label, level: lvl };
  };
}

// one flat list of { style, text }, blank paragraphs dropped. With tables on,
// a Word table arrives as one block rather than as its cells' paragraphs.
async function paragraphs(url, opts = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('cannot read ' + url + ' (' + res.status + ')');
  const files = await unzip(await res.blob());
  if (!files['word/document.xml']) throw new Error(url + ' is not a Word document');
  const xml = new TextDecoder().decode(files['word/document.xml']);
  const relXml = files['word/_rels/document.xml.rels'] ? new TextDecoder().decode(files['word/_rels/document.xml.rels']) : '';
  const rels = {};
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (m[0].match(/Id="([^"]+)"/) || [])[1], target = (m[0].match(/Target="([^"]+)"/) || [])[1];
    if (id && target && /hyperlink/i.test(m[0])) rels[id] = unescapeXml(target);
  }
  const body = (xml.match(/<w:body>([\s\S]*)<\/w:body>/) || [])[1] || '';
  const lists = listNumbering(files['word/numbering.xml'] ? new TextDecoder().decode(files['word/numbering.xml']) : '');
  const re = opts.tables
    ? /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g
    : /<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g;
  return [...body.matchAll(re)]
    .map(m => /^<w:tbl>/.test(m[0]) ? tableOf(m[0]) : ({ style: styleOf(m[0]), text: textOf(m[0]), bold: allBold(m[0]), runs: runsOf(m[0], rels), list: textOf(m[0]) ? lists(m[0]) : null }))
    .filter(b => b.text || (b.isTable && b.cells.length));
}

const isH1 = s => /^Heading1$|^Title$/i.test(s);
// Styled first, appearance second — and never for a list paragraph, which is a
// bullet that happens to be bold.
const heads = b => isH1(b.style) || (!b.list && b.style !== 'ListParagraph' && b.style !== 'IRBullet'
  && b.style !== 'IRStep' && b.style !== 'IRClause' && !isH2(b.style) && looksLikeHeading(b));

/** Says so once when the headings had to be inferred from bold. */
function noteInferred(paras, warnings, label) {
  const inferred = paras.filter(b => !isH1(b.style) && heads(b)).length;
  if (inferred) {
    warnings.push(label + ': ' + inferred + ' heading' + (inferred > 1 ? 's were' : ' was')
      + ' recognised from bold text rather than the Heading 1 style, and printed as headings. '
      + 'Styling them Heading 1 in Word makes this certain.');
  }
}
// Word carries a bullet either as the IR Bullet style, as a list paragraph, or
// as a typed glyph. All three set as bullets; the glyph is the layout's.
const BULLET_GLYPH = /^[\u2022\u25cf\u25aa\u00b7\u2013-]\s+/;
const isBulletPara = b => b.style === 'IRBullet' || b.style === 'ListParagraph' || BULLET_GLYPH.test(b.text);
const debullet = t => String(t).replace(BULLET_GLYPH, '');
const isH2 = s => /^Heading2$|^Heading3$/i.test(s);
const KNOWN = ['Heading1', 'Heading2', 'Heading3', 'Title', 'Normal', 'IRStep', 'IRClause', 'IRBullet', 'BodyText', 'ListParagraph', 'Table'];

function flagUnknown(blocks, warnings, label) {
  const odd = [...new Set(blocks.map(b => b.style).filter(s => !KNOWN.includes(s)))];
  if (odd.length) warnings.push(label + ': paragraph style' + (odd.length > 1 ? 's ' : ' ') + odd.map(s => '"' + s + '"').join(', ') + ' not recognised — those paragraphs are set as body copy.');
}

// ---- page 52, Industry Notice ------------------------------------------------

export async function loadNotice(url) {
  const warnings = [];
  const paras = await paragraphs(url, { tables: true });
  flagUnknown(paras, warnings, 'Industry Notice');
  noteInferred(paras, warnings, 'Industry Notice');

  let step = 0;
  const blocks = paras.map(b => {
    if (b.isTable) return b;
    if (heads(b) || isH2(b.style)) step = 0;
    if (b.style === 'IRStep') step += 1;
    const head = heads(b) || isH2(b.style);
    // a Word numbered list prints as numbered steps, with Word's own numbers
    const numbered = !head && !!b.list && b.list.kind === 'number';
    const stepped = b.style === 'IRStep' || numbered;
    const bullet = !head && !stepped && b.style !== 'IRClause' && ((b.list && b.list.kind === 'bullet') || isBulletPara(b));
    return {
      isSubject: heads(b),
      isSubhead: isH2(b.style),
      isStep: stepped,
      isClause: !stepped && b.style === 'IRClause',
      isBullet: bullet,
      isPara: !head && !bullet && !stepped && b.style !== 'IRClause',
      no: numbered ? b.list.label : b.style === 'IRStep' ? step + '.' : '',
      text: bullet ? debullet(b.text) : b.text,
      runs: printRuns(bullet ? debulletRuns(b.runs) : b.runs)
    };
  });

  const subjects = blocks.filter(b => b.isSubject).length;
  if (blocks.length && !subjects) warnings.push('Industry Notice: no heading, styled or bold — the notice will print without a subject heading.');
  if (subjects > 2) warnings.push('Industry Notice: ' + subjects + ' Heading 1 paragraphs. Page 52 is built for one notice, occasionally two.');
  blocks.filter(b => b.isStep).forEach(b => {
    if (/^\d+[.)]\s/.test(b.text)) warnings.push('Industry Notice: a step begins with its own number ("' + b.text.slice(0, 30) + '…"). Numbering is applied by the layout — remove it to avoid "1. 1.".');
  });
  const lines = blocks.filter(b => !b.isSubject).reduce((n, b) => n + Math.ceil(b.text.length / 118), 0);
  const depth = estimate(blocks, NOTICE_METRICS);
  if (depth > PAGE_DEPTH) {
    warnings.push('Industry Notice: about ' + Math.round(depth) + 'pt of copy against ' + PAGE_DEPTH
      + 'pt on the page \u2014 it will run to ' + Math.ceil(depth / PAGE_DEPTH) + ' pages.');
  }

  return { blocks, warnings, empty: !blocks.length, count: blocks.length, lines, depth };
}

// ---- page 53, From the Stewards' Room ---------------------------------------

export async function loadStewards(url) {
  const warnings = [];
  const paras = await paragraphs(url, { tables: true });
  flagUnknown(paras, warnings, 'Stewards Room');
  noteInferred(paras, warnings, 'Stewards Room');

  const blocks = paras.map(b => {
    if (b.isTable) return b;
    const head = heads(b) || isH2(b.style);
    const numbered = !head && !!b.list && b.list.kind === 'number';
    const bullet = !head && !numbered && b.style !== 'IRClause' && ((b.list && b.list.kind === 'bullet') || isBulletPara(b));
    return {
      isHeading: heads(b),
      isSubhead: isH2(b.style),
      isStep: numbered,
      no: numbered ? b.list.label : '',
      isClause: !numbered && b.style === 'IRClause',
      isBullet: bullet,
      isPara: !head && !bullet && !numbered && b.style !== 'IRClause',
      text: bullet ? debullet(b.text) : b.text,
      runs: printRuns(bullet ? debulletRuns(b.runs) : b.runs)
    };
  });

  const topics = blocks.filter(b => b.isHeading).length;
  if (blocks.length && !topics) warnings.push('Stewards Room: no topic heading found, styled or bold — every topic needs one.');
  if (blocks.length && !blocks[0].isHeading) warnings.push('Stewards Room: the document does not open with a topic heading.');
  if (topics > 4) warnings.push('Stewards Room: ' + topics + ' topics \u2014 two or three is the usual shape for this page.');
  const lines = blocks.reduce((n, b) => n + Math.ceil(b.text.length / 118), 0);
  const depth = estimate(blocks, STEWARDS_METRICS);
  if (depth > PAGE_DEPTH) {
    warnings.push('Stewards Room: about ' + Math.round(depth) + 'pt of copy against ' + PAGE_DEPTH
      + 'pt on the page \u2014 it will run to ' + Math.ceil(depth / PAGE_DEPTH) + ' pages.');
  }

  return { blocks, topics, warnings, empty: !blocks.length, count: blocks.length, lines, depth };
}

// ---- page 54, Rules Extracts ------------------------------------------------

export async function loadRules(url) {
  const warnings = [];
  const paras = await paragraphs(url);
  flagUnknown(paras, warnings, 'Rules Extracts');
  noteInferred(paras, warnings, 'Rules Extracts');

  const groups = [];
  paras.forEach(b => {
    if (heads(b)) {
      const ref = (b.text.match(/^((?:AR|LR)\s*\d+[A-Z]?)/i) || [])[1] || '';
      groups.push({ heading: b.text, ref: ref.trim(), blocks: [] });
      return;
    }
    if (!groups.length) {
      warnings.push('Rules Extracts: text before the first heading — "' + b.text.slice(0, 40) + '…" will not print.');
      return;
    }
    groups[groups.length - 1].blocks.push({
      isClause: b.style === 'IRClause',
      isPara: b.style !== 'IRClause',
      text: b.text,
      runs: printRuns(b.runs)
    });
  });

  groups.forEach(g => {
    if (!g.blocks.length) warnings.push('Rules Extracts: "' + g.heading + '" has a heading but no extract text.');
  });
  const dupes = groups.map(g => g.heading).filter((h, i, a) => a.indexOf(h) !== i);
  if (dupes.length) warnings.push('Rules Extracts: heading repeated — ' + [...new Set(dupes)].map(h => '"' + h + '"').join(', ') + '. Intentional in the August edition, where the LR 74A preamble and the rule itself both carry the heading.');
  const lines = groups.reduce((n, g) => n + 2 + g.blocks.reduce((m, b) => m + Math.ceil(b.text.length / 46), 0), 0);
  if (lines > 190) warnings.push('Rules Extracts: about ' + lines + ' lines across three columns. Page 54 holds roughly 190 — this will overrun.');

  return { groups, warnings, empty: !groups.length, count: groups.length, lines };
}

// ---- page 50, Division of Races Policy --------------------------------------

export async function loadPolicy(url) {
  const warnings = [];
  const paras = await paragraphs(url);
  flagUnknown(paras, warnings, 'Division of Races Policy');

  const head = paras.find(b => heads(b));
  const heading = (head || {}).text || '';
  const bullets = paras.filter(b => b !== head).map(b => b.text);
  const unstyled = paras.filter(b => b !== head && b.style !== 'IRBullet').length;

  if (!heading) warnings.push('Division of Races Policy: no heading, styled or bold — page 50 will fall back to its printed title.');
  if (!bullets.length) warnings.push('Division of Races Policy: no bullets — the page prints the heading over empty space.');
  if (bullets.filter(t => !String(t).trim()).length) {
    warnings.push('Division of Races Policy: some bullets have no text.');
  }
  if (unstyled) warnings.push('Division of Races Policy: ' + unstyled + ' bullet' + (unstyled > 1 ? 's are' : ' is') + ' not styled IR Bullet — still printed as bullets.');
  bullets.forEach(t => {
    if (/^[•\-\u2013]\s*/.test(t)) warnings.push('Division of Races Policy: a bullet starts with its own bullet character — the layout adds it.');
  });
  if (bullets.length > 12) warnings.push('Division of Races Policy: ' + bullets.length + ' bullets. Page 50 holds about 12 before the trials panel is pushed off.');

  return { heading, bullets, warnings, empty: !bullets.length, count: bullets.length };
}

export { runsOf };
