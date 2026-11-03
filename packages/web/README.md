# tripmap web

The browser front end for tripmap. It talks only to `tripmap-api` (see `../../docs/api.md`),
through the Vite dev server's `/api` proxy.

```sh
uv run tripmap-api          # in the repo root: http://127.0.0.1:8000
npm install
npm run dev                 # http://localhost:5173
npm test                    # Vitest, offline
npm run build
```

The trip is held in memory in the browser. Nothing is saved on the server.
