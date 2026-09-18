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
These arrive at full camera resolution (6516×7385 in October), which is far too
heavy to composite on every page relayout, so the pages load a derivative:
`assets/photos/cover.jpg` at 2600px on the long edge. **Regenerate the
derivative whenever `inputs/Cover.jpg` changes** — the pages never reference the
original. It was 1800px until the framing began enlarging the hero; the visible
slice of an enlarged frame is little more than half the file's width, so the
derivative needs the headroom.

`parsers/cover-frame.js` frames it. **The photograph starts at the foot of the
masthead, not at the head of the page**, and runs to the page foot; the strip
left above it is painted in a colour sampled from the picture's own top edge, so
the sky reads as continuous behind the wordmark. Nothing in the picture can
therefore cross the header, whatever it holds and however it measures.

That is deliberately structural, not measured. Two editions ran with the horse's
head under the wordmark while the framing was solved from a reading of where the
subject's leading edge sat: a frame whose crop is driven by its height has no
vertical overflow left to slide at all, and where there is overflow the amount
to slide depends on getting that edge right — which an energy scan does not do
reliably on a frame filled with one large subject. **Never restore a framing that
puts the photograph behind the masthead and relies on a measurement to keep the
subject clear.**

The photograph always **fills** that window, edge to edge and masthead foot to
page foot. Printing it under size instead only opens a band of flat sampled
colour under the wordmark, which reads as a mistake however well the colour is
matched.

The measurement does the job it is good at: sizing the subject and placing it in
the space that is free.

- The **hero** runs from the subject's leading edge (the first row carrying
  detail) to the foot of the interest band. Sizing off the interest band alone
  measures a horse from the shoulder down, and a frame given deliberate
  headroom then prints as mostly sky.
- The hero is enlarged to fill about 82% of the clear depth, and **further if
  the teaser strip demands it**: with the picture's foot on the page foot, only
  what lies below the hero in the frame separates the hooves from the strip, and
  only a larger picture opens that gap. Where the width cap and the teaser
  disagree, **the teaser wins** — an inch lost off the sides is ordinary for a
  cover, a horse standing on the teaser strip is not.
- Down the page the hero is **centred in the clear space**, not aimed by its
  energy centroid, with 18pt held at each end. The centroid sits wherever detail
  is heaviest — the crowd, the grandstand glass — and the keep-band then drags
  the crop to one limit.
- Across the page, column energy is measured **over the hero's own rows and at a
  tighter share**, and that band is centred. Whole-frame column energy cannot
  find the subject sideways: a grandstand runs the full depth and carries more
  detail than a horse, so its band starts hard at the left edge and the crop
  took the horse's hindquarters off the page.

An enlargement is expressed as the element's own size with the page cropping it,
never as `object-position` inside a window-sized box — `cover` recomputes its
own fit inside whatever box it is handed, so an enlargement written that way is
silently discarded and the picture prints at plain cover scale.

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

## The entry deadlines export is mechanical; the printed section is not
`inputs/Entry Deadlines.csv` is a six-days-out calculation. Two workbooks the
team keeps by hand sit over it, both read by `parsers/deadlines.js` in the same
call as the export, both optional:

- `inputs/Feature Race Deadlines - Entry Deadlines.xlsx` — Date, Race, Stage,
  Time, Meeting date. The real feature schedule, which runs through late
  entries and staged acceptances the program file cannot know. **Where the
  sheet has rows they replace every feature race line the export produced** —
  otherwise a race prints twice, once on its real date and once six days out.
  A date the export never listed becomes a day of its own, which is how the
  Melbourne Cup's final acceptance reaches 31 October. Stages print
  latest-first, as the published edition sets them.
- `inputs/Meeting Corrections - Entry Deadlines.xlsx` — Date, Heading, Meeting
  as supplied, Print as, Time. For the ordinary lines: a trials meeting prints
  without its sponsor, or a time the export has wrong.

**The export's `date_order` column is month-first** (`8/3/2026` is 3 August),
so the date is read off the printed heading — "Monday, 3 August" — with the
year taken from the numeric column. One October export arrived day-first, so
both are accepted; never trust the numeric column's order alone.

A sheet left over from another month reads as every date missing, and the run
says so once rather than eleven times.

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

- **Class labels never break.** `0-56`, `0 - 56`, `BM 62`, `F&M`, `0-70+` hold
  together across a line break. A word joiner (`\u2060`, zero-width, no glyph)
  removes the break opportunity and a non-breaking space replaces a space
  inside a label, so nothing printed changes. `chAtomic()` in the edition files
  and `atomic()` on the chart page. **Make the text atomic before splitting it
  into words for the fit measure, never after** — split first and `0 - 56`
  reaches the rule as three separate words, nothing holds it together, and the
  column prints "0 -" over "56", which is how October's Murtoa cell went out.
- **A run of spaces collapses to one.** Some cells are typed `1200m  G2` where
  the column two over reads `1100m G2`; the spacing of a class after a distance
  is the same everywhere.
- **A cell the export wrapped in quotes is unwrapped.** The tab-separated files
  do not need quoting and mostly do not use it, but one October export quoted
  every cell, which printed the deadlines day headings as `"THURSDAY, 1
  OCTOBER"` and left the eyebrow reading `OCTOBER" - NOVEMBER" 2026`. The
  unwrapping is in `parsers/tsv.js`, so every tab-separated input gets it; a
  stray quote *inside* a cell is left alone, since a race name may carry an
  inch mark.
- **The chart's column heads are fitted to their boxes.** A label is held
  together with word joiners, so one wider than the column cannot break and
  overhangs the rule — `0-62/BM62,` did. `chHeadSize()` sets the head a half
  point smaller instead, and **the whole cell moves together**: a head of two
  or three lines at mixed sizes reads as uneven leading even when the leading
  is identical.
- **A whitespace-only run beside a VOBIS block is dropped.** Pulling the label
  out of its run only reaches the pieces of that one run; the workbook also
  leaves the newline as a run of its own, which arrives as an atom in its own
  right and printed as a blank line between VOBIS Silver and VOBIS Gold.
- **VOBIS labels start their own line, set bold**, as a block out of whatever
  run carried them — and **no blank line between one VOBIS type and the next**.
  The workbook leaves a newline beside the label; beside a block it would print
  as an empty line.
- **The chart's column heads are bold, on one leading** (8.4pt) whatever the
  number of lines in the cell.
- **Gotham Narrow Bold is a real face now** — `fonts/GothamNarrow-Bold.otf`,
  H&FJ 2.200 Pro, declared at weight 700 on every page. The hairline
  `-webkit-text-stroke` that stood in for it is gone; **never bring it back**.
  Bold is wider than Book, so `chFitSize()` measures at the weight the word
  will actually print — measured at 400 a bold race name reads as fitting and
  then overhangs its column.
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
- Race series blocks sit 15pt apart, not 20pt and not 34pt. The packer
  constant and the rendered gap must stay the same figure.
- **The order of the race series does not matter; the space does.** Each
  column takes the deepest block still to place that will fit it, which closes
  the white space a fixed order leaves at a column foot. **The highweight
  schedule always prints last**, under the final series in the right-hand
  column.
- **The chart's country blue is `#007ba8`** — the workbook's `#00B0F0` read 30%
  darker for print — and the key swatch matches it. Column shading is
  `#f4fafd`.
- **The contents page carries a rule above the first row**, as the published
  edition does, and the accuracy note sets at 7.8pt directly under the last
  row's rule rather than adrift above the panel.
- **The Division of Races Policy is set to fit under the trials**: 17pt
  heading, 7.5pt body on 8.6pt. Its depth estimate and its printed styles are
  the same figures and must move together.
- **A whole-page ad is a bookable blank by default.** HR Assist is benched in
  the library (`enabled: false`), so every full page prints its slot id and
  size until `inputs/Ad Placements.csv` books it.

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
