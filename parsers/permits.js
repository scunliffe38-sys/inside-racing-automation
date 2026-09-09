// Permits to ride in races (page 47) — reads the monthly apprentices workbook
// and returns the records page 47 renders, plus anything worth shouting about.
//
// Source: inputs/Permits to Ride.xlsx
// Expected sheet layout, one apprentice per row after a single header row:
//   A APPRENTICE            H EXP DATE
//   B WGT                   I ALLOWED Kgs - METRO
//   C CAT                   J ALLOWED Kgs - PROV
//   D MASTER                K ALLOWED Kgs - OTHER
//   E Apprentice Contact    L METRO WINS
//   F Trainer Contact       M PROV WINS
//   G Agent Contact         N OTHER WINS
//                           O TOTAL WINS

import { readSheet, excelDate } from './xlsx.js';

const EXPECTED = ['APPRENTICE', 'WGT', 'CAT', 'MASTER'];
const MIN_ROWS = 20;
const MAX_ROWS = 80;

// strips a leading "(A) " / "(M) " / "(R) " marker — page 47 adds its own
const phone = v => String(v || '').replace(/^\([AMR]\)\s*/i, '').replace(/\s+/g, ' ').trim();
const num = v => String(v || '').trim();

export async function loadPermits(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('cannot read ' + url + ' (' + res.status + ')');
  const rows = await readSheet(await res.blob());
  const warnings = [];

  const head = rows[0] || {};
  const headText = ['A', 'B', 'C', 'D'].map(k => String(head[k] || '').toUpperCase());
  if (EXPECTED.some((e, i) => headText[i] !== e)) {
    warnings.push('Header row is not the expected APPRENTICE / WGT / CAT / MASTER — columns may have moved. Found: ' + headText.join(' | '));
  }

  const body = rows.slice(1).filter(r => (r.A || '').trim());
  const permits = body.map((r, i) => {
    const rec = {
      Apprentice: r.A,
      Wgt: num(r.B),
      Cat: (r.C || '').trim(),
      Master: (r.D || '').replace(/\s+/g, ' ').trim(),
      ApprenticePhone: phone(r.E),
      MasterPhone: phone(r.F),
      AgentPhone: phone(r.G),
      ExpDate: excelDate(r.H),
      AllowMetro: num(r.I), AllowProv: num(r.J), AllowOther: num(r.K),
      WinsMetro: num(r.L), WinsProv: num(r.M), WinsOther: num(r.N),
      WinsTotal: num(r.O)
    };
    const line = 'row ' + (i + 2) + ' (' + (rec.Apprentice || 'blank') + ')';
    if (!rec.Wgt) warnings.push('No weight — ' + line);
    if (!rec.Master) warnings.push('No master — ' + line);
    if (!rec.ExpDate) warnings.push('No expiry date — ' + line);
    if (rec.Cat && !/^[AB]$/.test(rec.Cat)) warnings.push('Category is "' + rec.Cat + '", expected A, B or blank — ' + line);
    // a bare 5-digit number in a contact column is an Excel date that has landed in the wrong cell
    [['Apprentice contact', rec.ApprenticePhone], ['Trainer contact', rec.MasterPhone], ['Agent contact', rec.AgentPhone]]
      .forEach(([label, v]) => {
        if (/^\d{1,5}$/.test(v)) warnings.push(label + ' is "' + v + '", which is not a phone number (' + (Number(v) > 40000 ? 'it reads as the date ' + excelDate(v) : 'too short') + ') — ' + line);
      });
    const parts = [rec.WinsMetro, rec.WinsProv, rec.WinsOther].map(Number);
    if (parts.every(n => isFinite(n)) && isFinite(Number(rec.WinsTotal))) {
      const sum = parts[0] + parts[1] + parts[2];
      if (sum !== Number(rec.WinsTotal)) {
        warnings.push('Wins do not add up (' + parts.join('+') + ' = ' + sum + ', total says ' + rec.WinsTotal + ') — ' + line);
      }
    }
    return rec;
  });

  if (permits.length < MIN_ROWS || permits.length > MAX_ROWS) {
    warnings.push('Found ' + permits.length + ' apprentices, expected between ' + MIN_ROWS + ' and ' + MAX_ROWS + ' — check the export is complete.');
  }

  // page 47 prints sheet order, so this is a note rather than a fault — the
  // published edition has run out-of-sequence pairs before
  const outOfOrder = permits
    .map((p, i) => (i && p.Apprentice.localeCompare(permits[i - 1].Apprentice) < 0)
      ? permits[i - 1].Apprentice + ' before ' + p.Apprentice : null)
    .filter(Boolean);
  if (outOfOrder.length) {
    warnings.push('Not in strict alphabetical order (' + outOfOrder.join('; ')
      + ') — page 47 prints sheet order, so check this is intended.');
  }

  return { permits, warnings, count: permits.length };
}
