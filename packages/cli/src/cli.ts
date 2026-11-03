#!/usr/bin/env node
// The `tripmap` command. Subcommands are wired in later; for now it reports its version.

import { readFileSync } from 'node:fs'

/** The package version, read from package.json next to dist/ so there is one source of truth. */
export function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  return pkg.version
}

const args = process.argv.slice(2)
if (args.includes('--version') || args.includes('-V')) {
  console.log(version())
} else {
  console.error('usage: tripmap <trips|draft|render|serve> [options]')
  process.exitCode = 2
}
