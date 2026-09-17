# Inside Racing Automation — project notes

## Inputs
Everything lives in `inputs/` under stable filenames. The production team
overwrites a file and reopens its page; nothing else changes.

### Vic Calendar is split by month
The Victorian calendar is supplied as one workbook per month, named with a
" - mmm yy" suffix:

    inputs/Vic Calendar - Sep 26.xlsx
    inputs/Vic Calendar - Oct 26.xlsx

`parsers/chart.js` `loadCharts()` finds them, sorts them chronologically and
reads them as one continuous chart. **Always process these in chronological
order, never in filename or discovery order.** It probes from one month before
the edition month (taken from `edition` in Edition Settings) through thirteen
months after, warns on a gap in the sequence, and falls back to a single
unsuffixed `Vic Calendar.xlsx` if no suffixed files are found. Month
abbreviations are title-case three-letter: Jan, Feb, Mar … Sep, Oct, Nov, Dec.

If other inputs start arriving split by month, follow the same pattern: same
suffix format, chronological sort, gap warning.

### The cover photograph is an input
`inputs/Cover.jpg` is the month's cover photograph, overwritten each edition.
These arrive at full camera resolution (7797×9605 in August), which is far too
heavy to composite on every page relayout, so the pages load a derivative:
`assets/photos/cover.jpg` at 1800px on the long edge. **Regenerate the
derivative whenever `inputs/Cover.jpg` changes** — the pages never reference the
original. The cover page fills its window with it, cropped from the top, since
these are tall portrait frames with sky above the subject.

### Jumps arrives as three files on three rhythms
`inputs/Jumps Racing Program.xlsx` is the whole season, one row per jumps
meeting, with paired description/prizemoney columns for maiden hurdle,
restricted hurdle, open hurdle, restricted steeplechase and open steeplechase.
It is replaced once a year, not monthly. `parsers/jumps.js` keeps only the
edition month. Two shapes in the sheet matter: a meeting with two races of one
class runs onto a second row with the date and venue merged, which reads as a
row with no date and no venue and belongs to the meeting above; and a row with
a venue but no races is a trials or schooling day, kept out of the chart and
checked against the trials file instead.

`inputs/Jumps Trials.csv` holds the individual trial races, one row each, and
`inputs/Jumps Prizemoney Breakdowns.csv` holds the standing tiers. Both are
tab-separated with a header row, and both are meant to be edited by hand — the
breakdowns change rarely but must stay editable.

### Picnics is one workbook, one sheet per season
`inputs/Picnic Program.xlsx` keeps a worksheet per season ("2026 - 27", "2025-26",
"2024-25") and is replaced yearly. `parsers/picnics.js` reads every sheet and
filters by date, so a range crossing a season boundary needs no special
handling and past seasons drop out on their own. The section prints **everything
from the edition month onwards**, not a fixed horizon, so it runs to as many
pages as that takes — the 2026-27 season is 32 meetings over two pages. Passing
a month count to `loadPicnics` narrows it if that is ever wanted.

A meeting offering two or three races of one kind runs onto further sheet rows
with the date and venue merged, which reads as a row with no date and no venue
and belongs to the meeting above. The printed cell divides equally between them.
The eligibility notes at the foot of the sheet ride under the table, on the last
page when it has room and on a page of their own when it has not.

## The assembled edition renders from a bake, not the inputs
`Inside Racing Edition.dc.html` and its part files read `data/edition.json`,
which holds the parsed result of every input. Reading seventeen inputs live
takes too long for the PDF export, which snapshots a partly built document.
**Re-bake `data/edition.json` whenever an input changes** — the individual
section pages read the inputs directly and are the place to check a change
before baking.

## Pagination is an output, not a setting
Folios are never typed into Edition Settings. `parsers/pagination.js` holds the
printed running order and adds up the pages in front of each section. Fixed
sections declare their extent; flowing sections (deadlines, chart, race
programs, agents, picnics, jump-outs and flat trials, race series, the
industry notice and the stewards’ room) call `report(id, count)` after laying
out, which caches to sessionStorage so other pages pick up the real count.

No section clips. Copy or tables longer than the page run onto a further page:
the trials go four meetings to a row, the series blocks alternate down two
columns until both are full, and the two notice documents break between
paragraphs with no heading left stranded at a page foot. Depth is estimated
from each style’s printed metrics rather than measured, so the pages can be
worked out before layout. Any `page_*`
row left in the workbook is flagged as stale and overwritten.

## Conditional sections
Five sections are conditional, all Yes/No in Edition Settings and all set from
the producer console. When a flag is No the section takes no pages, the contents
page drops its row, and everything after it moves up.

`jumps_included` and `picnics_included` default **out** — they run in their
seasons, and the console proposes Yes for the months that usually carry them.

`notice_included`, `stewards_included` and `rules_included` default **in**: the
Industry Notice, From the Stewards' Room and Rules and Notices run in most
months, so a blank or missing setting reads as Yes. Never let a blank drop these
— an edition built before the toggles existed has no value for them. Switching
one off also stops the run looking for its .docx, so no awaiting-copy warning
is raised for a section that was deliberately left out.

## Word documents arrive bold, not styled
`parsers/notices.js` reads block type from the paragraph style — Heading 1 for a
topic, Heading 2 for a sub-heading, Normal for body copy. In practice Integrity
Services and the Stewards set their headings **bold by hand**, which leaves the
whole document Normal and every heading invisible to a style test. So a
paragraph that is bold end to end, 90 characters or fewer, and not punctuated
as a sentence is read as a heading as well, and the run warns that styling it
Heading 1 would make it certain. An explicit Heading 1 always wins. This applies
to all four documents: the Industry Notice, Stewards Room, Rules Extracts and
the Division of Races Policy. **Never tighten this back to a style-only test** —
an October edition arrived with 26 unstyled paragraphs and printed as an
awaiting-copy panel because of it.

## Typography rules the markup asks for
These were set from the October review and are not preferences to re-litigate:

- **Class labels never break.** `0-56`, `BM 62`, `F&M`, `0-70+` hold together
  across a line break. A word joiner (`\u2060`, zero-width, no glyph) removes
  the break opportunity and a non-breaking space replaces a space inside a
  label, so nothing printed changes. `chAtomic()` in the edition files and
  `atomic()` on the chart page.
- **VOBIS labels start their own line**, set as a block out of whatever run
  carried them.
- **A venue qualifier is capitalised** — CRANBOURNE (NIGHT), not (Night).
- **`OPEN 1701 AND OVER` prints as 1701M.** The workbook is left alone; the
  chart header normalises any bare distance before `AND OVER`.
- **No mid-word breaks in chart cells** — `hyphens:manual`, never `auto`.
- **Leading inside a chart cell is uniform.** The calendar export carries stray
  double newlines; any run of newlines collapses to one.
- **The chart grid stops clear of the footer.** `FOOTER_RESERVE = 40`.
- **No single line of a race carries into a new column.** When a column
  boundary would leave exactly one atom of a race on its own, one more atom is
  handed forward — unless that would empty the column.
- **A wrapped prizemoney breakdown puts its weight condition on its own line.**
  The column holds about 44 characters; past that, "Set Weights." is its own
  atom.
- **The trials spread across all four columns on the last page**, filled to the
  shallowest common depth that takes every remaining race, which also frees the
  depth the Division of Races Policy needs beneath them.
- Race series blocks sit 20pt apart, not 34pt. The packer constant and the
  rendered gap must stay the same figure.

## The summary chart's colour comes from the workbook
The venue name's colour marks metropolitan against country, and the meeting
block mixes 6pt and 9pt type. Both are read out of the workbook's own rich-text
runs, not applied by the template, so a month whose rows arrive unformatted
prints flat and `parsers/chart.js` warns "No venue colour on …". When a whole
month loses its styling, the workbook is the place to look, not the page.

## Advertising
`parsers/ads.js` holds the house-ad library, the bookable slots, the slot rules
and the count. House artwork lives as PNG under `assets/ads/` and
`assets/photos/` and recurs every edition; a new house ad means dropping
artwork there and adding a `LIBRARY` entry — `kind` is how it prints, `slots` is
where it may run, `enabled: false` benches one.

Month-to-month bookings are an input. `inputs/Ad Placements.csv` is
tab-separated with a header row — `slot`, `artwork`, `caption`, `enabled`,
`notes` — one row per booked slot, and the producer drops the artwork in
`inputs/ads/`. `slot` is an id from `SLOTS` (`contents-panel`, `jumps-filler`,
`fullpage-1`) or `fullpage-N` for a signature padding page. A bare artwork
filename is resolved against `inputs/ads/`, then `assets/ads/`, then
`assets/photos/`, so house artwork can be named without a path. **A slot with
no row keeps its house ad; `enabled: no` runs it empty.** Missing artwork warns
and falls back rather than leaving a hole.

Two passes, because a booked full page changes the page count: `slotReport()`
prints the bookable slots with sizes in mm and px for the producer to fill the
CSV from, and pagination re-runs after the bookings are read.

Three placements, as the printed edition does it:

- **panel** — Stableline, in space the contents page does not use
- **filler** — Off The Track photo under a short section page (Jumps Program)
- **full page** — HR Assist, the page before the back cover

Full-page count is not fixed. One always runs; the saddle-stitch shortfall runs
as further ad pages rather than blank paper, so `plan()` returns `ads` and
grows `count.fullpage`, moving the back cover down. **Never pad an edition with
a blank page — pad it with advertising.**

Automatic fill: a page leaving more than 40% of its live depth empty is a filler
candidate (`hasBlankSpace`, `fillers()`), deepest gap first. The assembled
edition measures every page once it has laid out and draws a bookable panel in
what is left over, named after the folio it sits on — `page-26`. That name is
the slot id: put it in `inputs/Ad Placements.csv` with artwork and the panel
becomes the ad. The panel prints its own size in mm and pixels at 300dpi.
