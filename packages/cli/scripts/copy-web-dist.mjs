// prepack: copy the built web app (packages/web/dist) into web-dist/, which `tripmap serve`
// serves and package.json `files` ships. Fails loudly if the web app has not been built.
import { cpSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../../web/dist/', import.meta.url))
const dest = fileURLToPath(new URL('../web-dist/', import.meta.url))

if (!existsSync(`${src}index.html`)) {
  console.error('packages/web/dist is missing; run `npm run build` first.')
  process.exit(1)
}
rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true })
console.log('Copied the web app into web-dist/.')
