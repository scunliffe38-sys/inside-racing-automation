// Eligible to ride in trials — inputs/Eligible to Ride in Trials.xlsx
// One rider per row under a header row: Name | Phone | Category. Columns are
// found by header name, falling back to A/B/C. Returns the rows plus the same
// tab-separated text the pages and the bake have always carried (trialsText).
import { readSheet } from './xlsx.js';

// Excel drops the leading 0 off a mobile typed as a number: 456616652 -> 0456 616 652
const phone = v => {
  let s = String(v || '').replace(/\s+/g, ' ').trim();
  if (/^4\d{8}$/.test(s)) s = '0' + s;
  if (/^04\d{8}$/.test(s)) s = s.slice(0, 4) + ' ' + s.slice(4, 7) + ' ' + s.slice(7);
  return s;
};

export async function loadEligible(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('cannot read ' + url + ' (' + res.status + ')');
  const rows = await readSheet(await res.blob());
  const warnings = [];
  const head = rows[0] || {};
  const find = (re, d) => Object.keys(head).find(k => re.test(head[k] || '')) || d;
  const cN = find(/^name/i, 'A'), cP = find(/phone|contact|mobile/i, 'B'), cC = find(/^cat/i, 'C');
  if (!/^name/i.test(head[cN] || '')) warnings.push('Eligible to Ride in Trials: no Name header in row 1 — reading columns A, B, C.');
  const riders = rows.slice(1).filter(r => (r[cN] || '').trim()).map((r, i) => {
    const rec = { Name: r[cN].replace(/\s+/g, ' ').trim(), Phone: phone(r[cP]), Category: (r[cC] || '').replace(/\s+/g, ' ').trim() };
    if (!rec.Phone) warnings.push('Eligible to Ride in Trials: no phone — row ' + (i + 2) + ' (' + rec.Name + ')');
    if (!rec.Category) warnings.push('Eligible to Ride in Trials: no category — row ' + (i + 2) + ' (' + rec.Name + ')');
    return rec;
  });
  const clean = s => s.replace(/[\t\n"]/g, ' ');
  const text = ['Name\tPhone\tCategory'].concat(riders.map(r => [r.Name, r.Phone, r.Category].map(clean).join('\t'))).join('\n');
  return { riders, text, warnings, count: riders.length };
}
