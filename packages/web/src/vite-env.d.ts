/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MODE?: 'local' | 'hosted'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
