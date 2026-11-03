// Runs the BUILT CLI (dist/cli.js) with the Photos draft stubbed by a synthetic trip, so the
// draft path can be exercised in a real process without a Photos library or network.
import { main } from '../../dist/cli.js'

export const YAML = `# tripmap trip.
title: "Synthetic trip"
stops:
  - {name: "Alpha", at: [10.000, 20.000], nights: 1}
legs:
  - {date: 2020-01-01, mode: drive, via: ["Alpha", "Alpha"]}
`

process.exitCode = await main(process.argv.slice(2), {
  draft: async () => ({ yaml: YAML, summary: ['  1 overnight stops: Alpha (1)'] }),
})
