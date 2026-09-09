// Edition settings and riders' agents — the two workbooks that are hand-kept
// rather than exported.
//
//   inputs/Edition Settings.xlsx   Key | Value, one setting per row
//   inputs/Riders Agents.csv/.xlsx Agent | Riders | Contact, one agent per row
//
// Riders and multiple contact numbers are semicolon-separated inside their cell,
// which is what page 48 splits on to build its three rider columns.

import { readSheet } from './xlsx.js';
import { plan } from './pagination.js';
import { loadPlacements, slotReport } from './ads.js';
import { fetchDelimited, letterRows } from './tsv.js';

const REQUIRED = ['edition', 'wins_as_at', 'agents_footnote', 'trials_intro'];

// Yes/No switches for the sections that only run in some months.
const FLAGS = ['jumps_included', 'picnics_included'];

async function sheet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('cannot read ' + url + ' (' + res.status + ')');
  return readSheet(await res.blob());
}

export async function loadSettings(url) {
  const rows = await sheet(url);
  const warnings = [];
  const head = [String((rows[0] || {}).A || '').toLowerCase(), String((rows[0] || {}).B || '').toLowerCase()];
  if (head[0] !== 'key' || head[1] !== 'value') {
    warnings.push('Edition Settings: header row is "' + head.join(' | ') + '", expected Key | Value.');
  }
  const settings = {};
  rows.slice(1).forEach((r, i) => {
    const k = String(r.A || '').trim();
    if (!k) return;
    if (k in settings) warnings.push('Edition Settings: "' + k + '" appears twice — row ' + (i + 2) + ' wins.');
    settings[k] = String(r.B || '').trim();
  });
  REQUIRED.forEach(k => { if (!settings[k]) warnings.push('Edition Settings: "' + k + '" is missing or blank.'); });
  if (settings.wins_as_at && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(settings.wins_as_at)) {
    warnings.push('Edition Settings: wins_as_at is "' + settings.wins_as_at + '", expected dd/mm/yyyy.');
  }
  FLAGS.forEach(k => {
    if (!(k in settings)) warnings.push('Edition Settings: "' + k + '" row is missing \u2014 add it and set Yes or No.');
  });

  // Folios are worked out from the running order and this month's volumes, not
  // typed in. Any page_* row left in the workbook is stale and gets overwritten.
  const stale = Object.keys(settings).filter(k => /^page_/.test(k));
  if (stale.length) {
    warnings.push('Edition Settings: ' + stale.join(', ') + ' can be deleted \u2014 page numbers are calculated from section lengths now.');
  }
  // Advertising bookings, read before pagination: a booked full page changes
  // the page count, so the running order has to be worked out with them in hand.
  const placements = await loadPlacements('inputs/Ad Placements.csv');
  warnings.push(...placements.warnings);
  settings.$placements = { rows: placements.rows, bySlot: placements.bySlot };
  const pages = plan(settings, placements);
  warnings.push(...pages.warnings);
  settings.$pages = pages;
  settings.$adSlots = slotReport(pages.total, placements);
  Object.assign(settings, {
    page_deadlines: String(pages.start.deadlines || ''),
    page_chart: String(pages.start.chart || ''),
    page_programs: String(pages.start.programs || ''),
    page_permits: String(pages.start.permits || ''),
    page_agents: String(pages.start.agents || ''),
    page_jumps: String(pages.start.jumps || ''),
    page_picnics: String(pages.start.picnics || ''),
    page_jumpouts: String(pages.start.jumpouts || ''),
    page_series: String(pages.start.series || ''),
    page_notice: String(pages.start.notice || ''),
    page_stewards: String(pages.start.stewards || ''),
    page_notices: String(pages.start.rules || '')
  });
  return { settings, warnings, pages };
}

export async function loadAgents(url) {
  let rows;
  if (/\.(csv|tsv|txt)$/i.test(url)) {
    const { text } = await fetchDelimited(url);
    rows = letterRows(text);
  } else {
    rows = await sheet(url);
  }
  const warnings = [];
  const head = ['A', 'B', 'C'].map(k => String((rows[0] || {})[k] || '').toLowerCase());
  if (head[0] !== 'agent' || head[1] !== 'riders' || head[2] !== 'contact') {
    warnings.push('Riders\u2019 Agents: header row is "' + head.join(' | ') + '", expected Agent | Riders | Contact.');
  }

  const agents = rows.slice(1).filter(r => String(r.A || '').trim()).map((r, i) => {
    const rec = { Agent: String(r.A).trim(), Riders: String(r.B || '').trim(), Contact: String(r.C || '').trim() };
    const line = 'row ' + (i + 2) + ' (' + rec.Agent + ')';
    const riders = rec.Riders.split(';').map(x => x.trim()).filter(Boolean);
    if (!riders.length) warnings.push('Riders\u2019 Agents: no riders — ' + line + '.');
    if (rec.Riders.includes(',')) warnings.push('Riders\u2019 Agents: a comma in the riders cell — use semicolons, or the names run together — ' + line + '.');
    if (riders.length > 9) warnings.push('Riders\u2019 Agents: ' + riders.length + ' riders — more than nine can overrun the row height — ' + line + '.');
    if (!rec.Contact) warnings.push('Riders\u2019 Agents: no contact number — ' + line + '.');
    rec.Contact.split(';').map(x => x.trim()).filter(Boolean).forEach(n => {
      if (!/^(0[45]\d{2}\s\d{3}\s\d{3}|0\d\s\d{4}\s\d{4}|1800\s\d{3}\s\d{3})$/.test(n)) {
        warnings.push('Riders\u2019 Agents: contact "' + n + '" is not in the usual form (04XX XXX XXX or 0X XXXX XXXX) — ' + line + '.');
      }
    });
    return rec;
  });

  // page 48 orders agents by surname, not by the full name string
  const surname = n => (n.trim().split(/\s+/).slice(-1)[0] || '').toUpperCase();
  const sorted = agents.every((a, i) => i === 0 || surname(a.Agent).localeCompare(surname(agents[i - 1].Agent)) >= 0);
  if (!sorted) warnings.push('Riders\u2019 Agents: rows are not in surname order — page 48 prints them in sheet order.');
  if (agents.length > 45) warnings.push('Riders\u2019 Agents: ' + agents.length + ' agents — past about 45 the third column can overrun page 48.');
  if (!agents.length) warnings.push('Riders\u2019 Agents: no agents found.');

  return { agents, warnings, count: agents.length };
}
