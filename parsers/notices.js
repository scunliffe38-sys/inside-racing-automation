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

import { unzip } from './xlsx.js';

const unescapeXml = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#x?([0-9a-fA-F]+);/g, (m, c) => String.fromCharCode(/^&#x/i.test(m) ? parseInt(c, 16) : +c))
  .replace(/&amp;/g, '&');

const textOf = xml => unescapeXml(
  [...String(xml).matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('')
).replace(/\s+/g, ' ').trim();

const styleOf = xml => ((String(xml).match(/<w:pStyle\s+w:val="([^"]+)"/) || [])[1] || 'Normal');

// How deep the copy runs, in points, from the printed metrics of each paragraph
// style: the gap above it, its line height, and how many characters fit on a
// line at that size. Close enough to page on, and it needs no layout pass — the
// section pages use the same model to break their copy across pages.
const PAGE_DEPTH = 712;      // A4 less the title block and the folio zone

// Characters to the line measured off the printed page: a full-measure line
// at 8pt holds about 158, not the 118 a narrower column would.
const NOTICE_METRICS = {
  isSubject: [10, 17, 70], isSubhead: [11, 11, 120],
  isStep: [5, 10.4, 150], isClause: [4, 10.4, 152], isPara: [7, 10.4, 158]
};

const STEWARDS_METRICS = {
  isHeading: [13, 17, 70], isSubhead: [9, 11, 120],
  isClause: [4, 10.4, 152], isPara: [6, 10.4, 158]
};

function estimate(blocks, metrics) {
  const kinds = Object.keys(metrics);
  return blocks.reduce((total, b) => {
    const kind = kinds.find(k => b[k]) || 'isPara';
    const [gap, lh, cpl] = metrics[kind];
    return total + gap + Math.max(1, Math.ceil(String(b.text || '').length / cpl)) * lh;
  }, 0);
}

// one flat list of { style, text }, blank paragraphs dropped
async function paragraphs(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('cannot read ' + url + ' (' + res.status + ')');
  const files = await unzip(await res.blob());
  if (!files['word/document.xml']) throw new Error(url + ' is not a Word document');
  const xml = new TextDecoder().decode(files['word/document.xml']);
  const body = (xml.match(/<w:body>([\s\S]*)<\/w:body>/) || [])[1] || '';
  return [...body.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g)]
    .map(m => ({ style: styleOf(m[0]), text: textOf(m[0]) }))
    .filter(b => b.text);
}

const isH1 = s => /^Heading1$|^Title$/i.test(s);
const isH2 = s => /^Heading2$|^Heading3$/i.test(s);
const KNOWN = ['Heading1', 'Heading2', 'Heading3', 'Title', 'Normal', 'IRStep', 'IRClause', 'IRBullet', 'BodyText', 'ListParagraph'];

function flagUnknown(blocks, warnings, label) {
  const odd = [...new Set(blocks.map(b => b.style).filter(s => !KNOWN.includes(s)))];
  if (odd.length) warnings.push(label + ': paragraph style' + (odd.length > 1 ? 's ' : ' ') + odd.map(s => '"' + s + '"').join(', ') + ' not recognised — those paragraphs are set as body copy.');
}

// ---- page 52, Industry Notice ------------------------------------------------

export async function loadNotice(url) {
  const warnings = [];
  const paras = await paragraphs(url);
  flagUnknown(paras, warnings, 'Industry Notice');

  let step = 0;
  const blocks = paras.map(b => {
    if (isH1(b.style) || isH2(b.style)) step = 0;
    if (b.style === 'IRStep') step += 1;
    return {
      isSubject: isH1(b.style),
      isSubhead: isH2(b.style),
      isStep: b.style === 'IRStep',
      isClause: b.style === 'IRClause',
      isPara: !isH1(b.style) && !isH2(b.style) && b.style !== 'IRStep' && b.style !== 'IRClause',
      no: b.style === 'IRStep' ? step + '.' : '',
      text: b.text
    };
  });

  const subjects = blocks.filter(b => b.isSubject).length;
  if (blocks.length && !subjects) warnings.push('Industry Notice: no Heading 1 — the notice will print without a subject heading.');
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
  const paras = await paragraphs(url);
  flagUnknown(paras, warnings, 'Stewards Room');

  const blocks = paras.map(b => ({
    isHeading: isH1(b.style),
    isSubhead: isH2(b.style),
    isClause: b.style === 'IRClause',
    isPara: !isH1(b.style) && !isH2(b.style) && b.style !== 'IRClause',
    text: b.text
  }));

  const topics = blocks.filter(b => b.isHeading).length;
  if (blocks.length && !topics) warnings.push('Stewards Room: no Heading 1 — every topic needs one.');
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

  const groups = [];
  paras.forEach(b => {
    if (isH1(b.style)) {
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
      text: b.text
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

  const heading = (paras.find(b => isH1(b.style)) || {}).text || '';
  const bullets = paras.filter(b => !isH1(b.style)).map(b => b.text);
  const unstyled = paras.filter(b => !isH1(b.style) && b.style !== 'IRBullet').length;

  if (!heading) warnings.push('Division of Races Policy: no Heading 1 — page 50 will fall back to its printed title.');
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
