// Where the inputs come from.
//
// Every parser reads its input with fetch('inputs/<name>'), which resolves
// against wherever the pages are served from. That is right when the pages and
// the inputs sit together, and wrong when the month's files live in a shared
// location the producer keeps in SharePoint or OneDrive.
//
// A SharePoint URL cannot be fetched from a page — sign-in and cross-origin
// rules both stop it — so a shared location has to mean a folder synced onto
// the machine. This module lets the producer point at that folder once and
// then serves every inputs/ request out of it, by wrapping fetch. No parser
// changes, and nothing outside inputs/ is touched: fonts, artwork and the
// parsers themselves still load from the page's own origin.
//
//   pickFolder()      folder picker (Edge/Chrome), remembered between visits
//   useFiles(list)    fallback for browsers without the picker, or one-off runs
//   useBundled()      back to the inputs/ folder beside the pages
//   restore()         re-attach the remembered folder on load
//   state()           { mode, label, ready, needsPermission }
//   listing()         what is actually in the folder, with sizes and dates
//   stat(name)        one file's size and modified date, or null

const DB = 'ir-input-source';
const STORE = 'handles';
const KEY = 'folder';

let mode = 'bundled';        // bundled | folder | upload
let dir = null;              // FileSystemDirectoryHandle, as picked
let root = [];               // segments under it where the inputs actually sit
let map = null;              // Map<lowercased path under inputs/, File>
let label = 'inputs/ beside the pages';
let needsPermission = false;
let installed = false;
let origFetch = null;

/** The files an edition is built from, in the order the console lists them. */
export const EXPECTED = [
  { file: 'Entry Deadlines.csv', section: 'Entry deadlines', cadence: 'monthly', required: true },
  { file: 'Vic Calendar - <Mon YY>.xlsx', section: 'Programs summary chart', cadence: 'monthly', required: true, pattern: /^vic calendar( - [a-z]{3} \d{2})?\.xlsx$/ },
  { file: 'Race Programs.csv', section: 'Race programs', cadence: 'monthly', required: true },
  { file: 'Race Series.docx', section: 'Race series', cadence: 'monthly', required: true },
  { file: 'Highweights.docx', section: 'Race series', cadence: 'monthly', required: false },
  { file: 'Jumps Racing Program.xlsx', section: 'Jumps program', cadence: 'yearly', required: false },
  { file: 'Jumps Trials.csv', section: 'Jumps program', cadence: 'monthly', required: false },
  { file: 'Jumps Prizemoney Breakdowns.csv', section: 'Jumps program', cadence: 'rarely', required: false },
  { file: 'Picnic Program.xlsx', section: 'Picnic racing', cadence: 'yearly', required: false },
  { file: 'Jump Outs.xlsx', section: 'Jump outs', cadence: 'monthly', required: true },
  { file: 'Official Flat Trials.csv', section: 'Flat trials', cadence: 'monthly', required: true },
  { file: 'Eligible to Ride in Trials.csv', section: 'Flat trials', cadence: 'rarely', required: false },
  { file: 'Permits to Ride.xlsx', section: 'Permits to ride', cadence: 'monthly', required: true },
  { file: 'Riders Agents.csv', section: 'Riders\u2019 agents', cadence: 'monthly', required: true },
  { file: 'Industry Notice.docx', section: 'Industry notice', cadence: 'monthly', required: true },
  { file: 'Stewards Room.docx', section: 'Stewards\u2019 room', cadence: 'monthly', required: true },
  { file: 'Rules Extracts.docx', section: 'Rules extracts', cadence: 'monthly', required: true },
  { file: 'Division of Races Policy.docx', section: 'Division of races', cadence: 'rarely', required: false },
  { file: 'Ad Placements.csv', section: 'Advertising', cadence: 'monthly', required: false },
  { file: 'Cover.jpg', section: 'Cover', cadence: 'monthly', required: true }
];

// ---- persistence ------------------------------------------------------------

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function idbPut(value) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).put(value, KEY);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

async function idbGet() {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, 'readonly');
    const q = t.objectStore(STORE).get(KEY);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}

// ---- the fetch wrapper ------------------------------------------------------

/** 'inputs/ads/Stableline.png' -> 'ads/stableline.png'; anything else -> null */
function under(url) {
  let s = typeof url === 'string' ? url : (url && url.url) || '';
  if (!s) return null;
  try {
    const u = new URL(s, location.href);
    if (u.origin !== location.origin) return null;
    s = u.pathname + '';
  } catch (e) { /* keep the raw string */ }
  try { s = decodeURIComponent(s); } catch (e) { /* leave it */ }
  const i = s.toLowerCase().lastIndexOf('inputs/');
  return i < 0 ? null : s.slice(i + 7);
}

async function fromFolder(path) {
  if (!dir) return null;
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return null;
  // the producer may have picked the month's folder, its parent, or a folder
  // holding inputs/ — try the recorded root first, then the obvious variants
  const prefixes = [root, root.concat('inputs'), [], ['inputs']];
  for (const prefix of prefixes) {
    let d = dir;
    let ok = true;
    for (const seg of prefix.concat(parts.slice(0, -1))) {
      try { d = await d.getDirectoryHandle(seg); } catch (e) { ok = false; break; }
    }
    if (!ok) continue;
    try {
      const h = await d.getFileHandle(parts[parts.length - 1]);
      return await h.getFile();
    } catch (e) { /* try the next prefix */ }
  }
  return null;
}

function fromUpload(path) {
  if (!map) return null;
  const key = path.toLowerCase();
  return map.get(key) || map.get(key.split('/').pop()) || null;
}

export async function file(path) {
  if (mode === 'folder') return fromFolder(path);
  if (mode === 'upload') return fromUpload(path);
  return null;
}

function install() {
  if (installed) return;
  installed = true;
  origFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    if (mode !== 'bundled') {
      const path = under(input);
      if (path != null) {
        const f = await file(path);
        if (f) return new Response(f, { status: 200, headers: { 'content-type': f.type || 'application/octet-stream' } });
        return new Response(null, { status: 404, statusText: 'not found in ' + label });
      }
    }
    return origFetch(input, init);
  };
}

// ---- choosing a source ------------------------------------------------------

export const canPickFolder = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export async function pickFolder() {
  const handle = await window.showDirectoryPicker({ id: 'inside-racing-inputs', mode: 'read' });
  dir = handle;
  mode = 'folder';
  map = null;
  root = [];
  label = handle.name;
  needsPermission = false;
  install();
  // the pick may be the month's own folder or a parent holding one folder per
  // month — find where the inputs actually are and read from there
  const found = await candidates();
  if (found.length) root = found[0].segs;
  label = folderLabel();
  try { await idbPut({ handle, root }); } catch (e) { /* private mode: just don't remember it */ }
  return state();
}

/** Folders under the pick that hold inputs, best first. */
export async function candidates() {
  if (!dir) return [];
  const wanted = new Set(EXPECTED.filter(r => !r.pattern).map(r => r.file.toLowerCase()));
  const out = [];
  async function score(handle, segs, depth) {
    let hits = 0;
    const subs = [];
    try {
      for await (const [name, entry] of handle.entries()) {
        if (entry.kind === 'directory') subs.push([name, entry]);
        else if (wanted.has(name.toLowerCase()) || /^vic calendar/i.test(name)) hits++;
      }
    } catch (e) { return; }
    out.push({ segs, label: segs.length ? dir.name + '/' + segs.join('/') : dir.name, hits });
    if (depth > 0) for (const [name, entry] of subs) await score(entry, segs.concat(name), depth - 1);
  }
  await score(dir, [], 2);
  return out.filter(c => c.hits > 0).sort((a, b) => b.hits - a.hits);
}

/** Read from a particular folder under the pick (from candidates()). */
export async function setRoot(segs) {
  root = (segs || []).slice();
  label = folderLabel();
  if (dir) { try { await idbPut({ handle: dir, root }); } catch (e) { /* ignore */ } }
  return state();
}

function folderLabel() {
  if (!dir) return label;
  return root.length ? dir.name + '/' + root.join('/') : dir.name;
}

/** FileList from <input type="file" webkitdirectory> or a multi-file pick. */
export function useFiles(list) {
  const files = Array.from(list || []);
  map = new Map();
  let root = '';
  for (const f of files) {
    const rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
    if (!root) root = rel.includes('/') ? rel.split('/')[0] : '';
    const i = rel.toLowerCase().lastIndexOf('inputs/');
    const key = (i >= 0 ? rel.slice(i + 7) : rel.split('/').pop()).toLowerCase();
    map.set(key, f);
  }
  mode = 'upload';
  dir = null;
  label = root ? root + ' (copied into the browser)' : files.length + ' files';
  needsPermission = false;
  install();
  return state();
}

export function useBundled() {
  mode = 'bundled';
  dir = null;
  map = null;
  root = [];
  label = 'inputs/ beside the pages';
  needsPermission = false;
  return state();
}

/** Re-attach the folder picked on a previous visit. Silent when there is none. */
export async function restore() {
  if (!canPickFolder()) return state();
  let saved;
  try { saved = await idbGet(); } catch (e) { return state(); }
  if (!saved) return state();
  const handle = saved.handle || saved;   // older saves held the handle alone
  dir = handle;
  root = (saved.root || []).slice();
  label = folderLabel();
  let perm = 'prompt';
  try { perm = await handle.queryPermission({ mode: 'read' }); } catch (e) { /* older shape */ }
  if (perm === 'granted') { mode = 'folder'; needsPermission = false; install(); }
  else { mode = 'bundled'; needsPermission = true; }
  return state();
}

/** Ask again for the remembered folder — must run from a click. */
export async function reconnect() {
  if (!dir) return state();
  let perm = 'denied';
  try { perm = await dir.requestPermission({ mode: 'read' }); } catch (e) { /* fall through */ }
  if (perm === 'granted') { mode = 'folder'; needsPermission = false; install(); }
  return state();
}

export function state() {
  return {
    mode, label, ready: mode !== 'bundled', needsPermission, canPick: canPickFolder(),
    folder: dir ? dir.name : '', root: root.join('/')
  };
}

// ---- what is in there -------------------------------------------------------

async function walk(handle, prefix, out, depth) {
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === 'directory') {
      if (depth > 0) await walk(entry, prefix + name + '/', out, depth - 1);
    } else {
      const f = await entry.getFile();
      out.push({ path: prefix + name, name, size: f.size, modified: f.lastModified });
    }
  }
}

/** Everything the current source holds under inputs/, one level of subfolders. */
export async function listing() {
  const out = [];
  if (mode === 'folder' && dir) {
    let base = dir;
    for (const seg of root) { try { base = await base.getDirectoryHandle(seg); } catch (e) { break; } }
    try { base = await base.getDirectoryHandle('inputs'); } catch (e) { /* the folder itself holds them */ }
    await walk(base, '', out, 1);
  } else if (mode === 'upload' && map) {
    for (const [path, f] of map) out.push({ path, name: f.name, size: f.size, modified: f.lastModified });
  } else {
    // bundled: a static server gives no directory listing, so probe the manifest
    const names = EXPECTED.filter(r => !r.pattern).map(r => r.file).concat(calendarNames());
    const hits = await Promise.all(names.map(n => head(n).then(h => (h ? { path: n, name: n, size: h.size, modified: h.modified } : null))));
    out.push(...hits.filter(Boolean));
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Calendar filenames worth probing: a year either side of today. */
function calendarNames() {
  const now = new Date();
  const out = ['Vic Calendar.xlsx'];
  for (let k = -6; k <= 15; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
    out.push('Vic Calendar - ' + MONTH_ABBR[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2) + '.xlsx');
  }
  return out;
}

/** Size and date without downloading the file. Null when it isn't there. */
async function head(name) {
  const f = origFetch || window.fetch.bind(window);
  const at = 'inputs/' + name;
  try {
    const res = await f(at, { method: 'HEAD' });
    if (res.ok) {
      return {
        size: Number(res.headers.get('content-length')) || 0,
        modified: Date.parse(res.headers.get('last-modified') || '') || 0
      };
    }
  } catch (e) { /* try a range request */ }
  try {
    const res = await f(at, { headers: { Range: 'bytes=0-0' } });
    if (!res.ok && res.status !== 206) return null;
    const cr = res.headers.get('content-range') || '';
    const total = Number((cr.match(/\/(\d+)$/) || [])[1]) || 0;
    return { size: total, modified: Date.parse(res.headers.get('last-modified') || '') || 0 };
  } catch (e) { return null; }
}

export async function stat(name) {
  const f = await file(name);
  if (f) return { name, size: f.size, modified: f.lastModified };
  if (mode !== 'bundled') return null;
  const h = await head(name);
  return h ? { name, size: h.size, modified: h.modified } : null;
}

/** The Vic Calendar months the current source holds, chronological. */
export async function calendarMonths() {
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const all = await listing();
  return all
    .map(f => {
      const m = f.name.match(/^Vic Calendar - ([A-Za-z]{3}) (\d{2})\.xlsx$/i);
      if (!m) return null;
      return { name: f.name, month: MONTHS.indexOf(m[1].toLowerCase()), year: 2000 + Number(m[2]), modified: f.modified };
    })
    .filter(Boolean)
    .sort((a, b) => a.year - b.year || a.month - b.month);
}
