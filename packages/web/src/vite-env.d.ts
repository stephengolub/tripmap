/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MODE?: 'local' | 'hosted'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// The tripmap CLI version (packages/cli/package.json), injected by vite.config.ts.
declare const __TRIPMAP_VERSION__: string
