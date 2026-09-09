# Inside Racing Automation

Automated production of *Inside Racing*, Racing Victoria's monthly industry
publication. Inputs land in `inputs/`, the parsers read them, the pages lay
themselves out, and the edition exports as a print-ready PDF.

## Layout

| Path | What it holds |
|---|---|
| `inputs/` | The month's source files. Overwritten each edition. |
| `inputs/ads/` | Booked advertising artwork for the month. |
| `parsers/` | One parser per input, plus pagination, settings and advertising. |
| `data/edition.json` | The bake — every parsed input, read by the assembled edition. |
| `assets/` | Mastheads, section furniture, house advertising, photography. |
| `fonts/` | Gotham Narrow / Gotham Extra Narrow. |
| `docs/` | Architecture, production blueprint, run sheet, input source worksheet, test plan. |
| `*.dc.html` | The pages. `Inside Racing Edition.dc.html` is the assembled edition. |

## Producing an edition

1. Drop the month's files into `inputs/` under their existing names.
2. Regenerate `assets/photos/cover.jpg` from `inputs/Cover.jpg` at 1800px on
   the long edge.
3. Open each section page to check the parse before baking.
4. Re-bake `data/edition.json`.
5. Run the advertising slot report, fill `inputs/Ad Placements.csv`, drop
   artwork in `inputs/ads/`, then re-run so pagination picks up any full pages.
6. Export `Inside Racing Edition-print.dc.html` to PDF.

`PROJECT-NOTES.md` carries the rules that matter — split calendar files,
conditional sections, how pagination is computed rather than typed, and the
advertising two-pass. Read it before changing a parser.

## Conventions worth knowing

- **Pagination is an output, not a setting.** Folios are never typed into
  Edition Settings; `parsers/pagination.js` computes them.
- **Never pad an edition with a blank page** — pad it with advertising.
- **Inputs are stable by the 10th** of the month preceding publication.
