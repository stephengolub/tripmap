# @tripmap/core

`@tripmap/core` is the shared engine behind tripmap: the trip types, the trip YAML reader
and writer (same format as `docs/trip-format.md`), and, as the port continues, route
detection, geometry and SVG building. It runs in Node and in the browser, so the `tripmap`
CLI and the web editor share one implementation.

Node-only code (reading the Photos library, file and network access) lives under
`src/node/`. The browser bundle must never import anything from `src/node/`.
