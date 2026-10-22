# Personal website

## Civilization IV archive

`civ4/data/civ4-runs.json` is the single source of truth for run records.
The Runs tab in `civ4/index.html` fetches this file directly; edit the JSON
when correcting run metadata rather than embedding records in the HTML.
The request revalidates cached data on each page load.

Serve the site over HTTP for local previews (fetching JSON does not work
reliably when opening the HTML via `file://`).
