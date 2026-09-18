repo: scunliffe38-sys/inside-racing-automation
branch: main

## Last sync

date: 2026-09-18T23:40:00+10:00

### Updated in this project
- Gotham Narrow Bold added to fonts/ and declared on every page, so the chart heads, the ENTRIES / ACCEPTANCES / RIDERS labels, the trials riders' names and the VOBIS marks print in the real face; the hairline stroke that stood in for it is gone.
- The chart's fit measure reads a word at the weight it will print, since Bold is wider than Book.
- October's cover photograph in as the edition's cover, framed below the masthead with the whole horse in frame.

### Earlier the same day

### Updated in this project
- The cover photograph starts at the foot of the masthead and runs to the page foot, so nothing in the frame can cross the header whatever it holds; the strip above carries a colour sampled from the picture's own top edge.
- October review round two: class labels made atomic before the fit measure, runs of spaces collapsed, VOBIS marks bold with no blank line between types, chart heads bold on one leading, lighter column shading and a 30% darker country blue.
- Race series packs by depth in any order with the highweight schedule always last; block gap 15pt.
- Division of Races Policy set to fit under the trials; HR Assist benched so whole pages print as bookable blanks; contents rule and accuracy note as published.

## Sync history

date: 2026-09-18

### Updated in that sync
- Cover framing handles a photograph deeper than the page: it prints a little under full size, sits on the page foot, and the strip left at the head takes a colour sampled from the picture's own top edge.
- Producer console conditional rows keyed on the catalogue names, so the Industry Notice and Rules Extracts rows go quiet when their toggle is No.
- Race series, stewards' room, flat trials and the Division of Races Policy all fit their pages; four wide race names set without wrapping.

date: 2026-09-17

### Updated in that sync
- October review actioned: nineteen of the twenty-two marked-up comments are in the templates.
- Three new Yes/No toggles — Industry Notice, From the Stewards' Room, Rules and Notices — on the console and in pagination, all defaulting in.
- Notices parser reads a heading set bold by hand, not only one styled Heading 1, which is how all four Word documents actually arrive.
- Summary chart identifies a venue by its colour rather than an exact point size, so a month exported at 8pt keeps its metro/country colour and scale.

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
| index.html | Checklist.html, Producer Console.dc.html |
| Producer Console.dc.html | parsers/source.js, parsers/settings.js, parsers/pagination.js, parsers/ads.js |
| Inside Racing Input Checklist.dc.html | Checklist.html |
| Inside Racing Edition.dc.html | Inside Racing Part 1-3.dc.html, parsers/pagination.js, data/edition.json |
| Inside Racing Edition-print.dc.html | Inside Racing Edition.dc.html, doc-page.js |
| Cover.dc.html | parsers/cover-frame.js, assets/cover-masthead.svg, assets/photos/cover.jpg |
| Entry Deadlines.dc.html | parsers/deadlines.js, inputs/Entry Deadlines.csv |
| Programs Summary Chart.dc.html | parsers/chart.js, inputs/Vic Calendar - *.xlsx |
| Race Programs.dc.html | parsers/programs.js, inputs/Race Programs.csv |
| Race Series.dc.html | parsers/series.js, inputs/Race Series.docx |
| Jumps Program.dc.html | parsers/jumps.js, inputs/Jumps Racing Program.xlsx, inputs/Jumps Trials.csv |
| Picnic Racing.dc.html | parsers/picnics.js, inputs/Picnic Program.xlsx |
| Jump Outs and Flat Trials.dc.html | parsers/jumpouts.js, parsers/trials.js, parsers/notices.js |
| Permits and Riders Agents.dc.html | parsers/permits.js, inputs/Permits to Ride.xlsx, inputs/Riders Agents.csv |
| Notices.dc.html | parsers/notices.js, inputs/Industry Notice.docx, inputs/Stewards Room.docx, inputs/Rules Extracts.docx |
| Advertising | parsers/ads.js, inputs/Ad Placements.csv, assets/ads/ |
