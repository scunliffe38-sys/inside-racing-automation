repo: scunliffe38-sys/inside-racing-automation
branch: main

## Last sync

date: 2026-09-10T05:20:00Z

### Updated in this project
- Contents list compresses to fit above the "subject to change" note instead of colliding with it.
- Official Flat Trials run continuously to the foot of every page; the Division of Races Policy follows them whole, on its own page when it will not fit under the last trial.
- A short spill is pulled back into the page before it by tightening the day-block gap and the bottom clearance; a genuine spill sizes its own columns and offers the space beneath as a bookable ad slot.
- Race Programs and Entry Deadlines wait for their measuring render rather than bailing, and each part file now renders only its own sections.

## Sync history

date: 2026-09-10

### Updated in that sync
- Picnic programs table prints its dollar signs again; each picnic meeting carries an ISO date.
- Chart prizemoney is set unbreakable, so a long figure no longer splits mid-number.
- Printed running order corrected to Jump-Outs, Race Series, Picnic; contents and body folios now agree.
- Picnic meetings are matched out of Race Programs, jump-out columns sort by date and drop a stray month, and bulleted notice copy sets as bullets.

date: 2026-09-09

### Updated in that sync
- No section clips: the flat trials, race series, industry notice and stewards' room now run onto further pages, in the standalone pages and the assembled edition alike.
- Overrun warnings recalibrated against the measured page depth; `parsers/tsv.js` sniffs comma- or tab-separated inputs.
- Producer console added (`Producer Console.dc.html`) — source folder, edition settings, file catalogue, run, warnings, download.
- `parsers/source.js` serves every `inputs/` request out of a folder the producer picks (File System Access, remembered between visits).
- Edition settings moved out of the workbook into the console; `parsers/settings.js` reads them from there and only falls back to `Edition Settings.xlsx`.
- Agents footnote and trials introduction baked into the page designs.
- Excluded working detritus — `scraps/`, `uploads/`, `screenshots/` — via `.gitignore`.
- Added a repository README and moved the project notes to `PROJECT-NOTES.md`.

## Screen map

| Screen | Repo files |
|---|---|
| Producer Console.dc.html | parsers/source.js, parsers/settings.js, parsers/pagination.js, parsers/ads.js |
| Inside Racing Edition.dc.html | Inside Racing Part 1-3.dc.html, parsers/pagination.js, data/edition.json |
| Inside Racing Edition-print.dc.html | Inside Racing Edition.dc.html, doc-page.js |
| Cover.dc.html | assets/cover-masthead.svg, assets/photos/cover.jpg |
| Entry Deadlines.dc.html | parsers/deadlines.js, inputs/Entry Deadlines.csv |
| Programs Summary Chart.dc.html | parsers/chart.js, inputs/Vic Calendar - *.xlsx |
| Race Programs.dc.html | parsers/programs.js, inputs/Race Programs.csv |
| Race Series.dc.html | parsers/series.js, inputs/Race Series.docx |
| Jumps Program.dc.html | parsers/jumps.js, inputs/Jumps Racing Program.xlsx, inputs/Jumps Trials.csv |
| Picnic Racing.dc.html | parsers/picnics.js, inputs/Picnic Program.xlsx |
| Jump Outs and Flat Trials.dc.html | parsers/jumpouts.js, parsers/trials.js |
| Permits and Riders Agents.dc.html | parsers/permits.js, inputs/Permits to Ride.xlsx, inputs/Riders Agents.csv |
| Notices.dc.html | parsers/notices.js, inputs/Industry Notice.docx |
| Advertising | parsers/ads.js, inputs/Ad Placements.csv, assets/ads/ |
