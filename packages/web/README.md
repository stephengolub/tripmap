# tripmap web

The browser front end for tripmap. In local mode it talks only to `tripmap serve` (port 8787),
through the Vite dev server's `/api` proxy.

```sh
npm install                 # in the repo root
npx tsx ../cli/src/cli.ts serve   # http://127.0.0.1:8787
npm run dev                 # http://localhost:5173
npm test                    # Vitest, offline
npm run build
```

The trip is held in memory in the browser. Nothing is saved on the server.
