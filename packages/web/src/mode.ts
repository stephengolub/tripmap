// Build mode. `local` (the default) talks to `tripmap serve` under /api; `hosted` is the
// static GitHub Pages build, which has no API and drafts through the CLI's listener.
export type Mode = 'local' | 'hosted'

export const MODE: Mode = import.meta.env.VITE_MODE === 'hosted' ? 'hosted' : 'local'

// Local mode calls same-origin /api (served by `tripmap serve`, or proxied by Vite in dev).
export const API_BASE = ''
