---
type: report
title: TypeScript vs Python parity gate
created: 2026-11-03
tags:
  - parity
  - typescript-port
related:
  - '[[how-draft-works]]'
  - '[[trip-format]]'
---

# TypeScript vs Python parity gate

- Date: 2026-11-03
- Node: v22.14.0
- Python: 3.12.12
- Baseline: the Python drafts in `~/.cache/tripmap/regression-baseline/`
- TypeScript drafts: `npx tsx scripts/parity/run.ts`, written to `~/.cache/tripmap/parity/`
- Comparison: `npx tsx scripts/parity/compare.ts`
- Trip date ranges: read from `~/.cache/tripmap/parity/trips.json`, kept out of the repo

Both drafts were made from the same Photos library. Counts below come from the
comparison output; no names, dates, or coordinates are recorded here.

## Ireland

| Check | Result | Counts |
|---|---|---|
| photo count | PASS | py 810, ts 810 |
| overnight count | PASS | py 4, ts 4 |
| overnight names | PASS | 4 shared of 4 |
| overnight nights | PASS | 4/4 stops, 9 nights total on both sides |
| enabled legs | PASS | py 9, ts 9 |
| leg dates and modes | PASS | 9/9 in order |
| day_trip flags | PASS | 9/9 legs |
| via stop names | PASS | 9/9 legs |
| hidden stops | PASS | py 5, ts 5 |
| route hints within 300 m | PASS | 19/19 points |

## Italy

| Check | Result | Counts |
|---|---|---|
| photo count | PASS | py 571, ts 571 |
| overnight count | PASS | py 3, ts 3 |
| overnight names | PASS | 3 shared of 3 |
| overnight nights | PASS | 3/3 stops, 6 nights total on both sides |
| enabled legs | PASS | py 5, ts 5 |
| leg dates and modes | PASS | 7/7 in order |
| day_trip flags | PASS | 7/7 legs |
| via stop names | PASS | 7/7 legs |
| hidden stops | PASS | py 3, ts 3 |
| route hints within 300 m | PASS | 5/5 points |

## PNW

| Check | Result | Counts |
|---|---|---|
| photo count | PASS | py 675, ts 675 |
| overnight count | PASS | py 2, ts 2 |
| overnight names | PASS | 2 shared of 2 |
| overnight nights | PASS | 2/2 stops, 4 nights total on both sides |
| enabled legs | PASS | py 18, ts 18 |
| leg dates and modes | PASS | 20/20 in order |
| day_trip flags | PASS | 20/20 legs |
| via stop names | PASS | 20/20 legs |
| hidden stops | PASS | py 8, ts 8 |
| route hints within 300 m | PASS | 51/51 points |

## Accepted differences

- **Header comment filename.** A plain `diff` of each TypeScript draft against its
  Python baseline differs on one line per trip: the header comment's
  `tripmap render <file>` example, which echoes the output filename. The parity
  script writes `<trip>.ts.yaml` where the baseline was `<trip>.yaml`. It is a
  comment, not trip data, and follows from the output path only.
- **Photo counts.** None. All three counts equal the Python logs, so no photos
  were added to or removed from the library since the baseline.

Gate: PASS
