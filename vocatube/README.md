# VocaTube

VocaTube is a static HTML/CSS/JavaScript app. Firebase runs directly in the browser for optional Google sign-in and cloud sync.

## Architecture

The production frontend is fully static. A small Cloudflare Worker exists only for YouTube resources that cannot be fetched reliably from a browser because of CORS:

- `/api/transcript?videoId=…&lang=de`
- `/api/playlist?list=…`
- `/api/channel?handle=…`
- `/api/shorts?handle=…`

Successful Worker responses are cached at Cloudflare's edge. No database or server-side user state is used.

## Local development

Install Wrangler and run the local static/Worker adapter:

```bash
npm install
npm run serve
```

Open <http://localhost:8000>. `server.js` only serves static files and forwards `/api/*` requests to the same Worker module used in production.

To run Wrangler directly:

```bash
npm run dev
```

## Deploy the Worker

```bash
npx wrangler login
npm run deploy
```

Wrangler prints a URL similar to:

```text
https://vocatube-youtube.YOUR-SUBDOMAIN.workers.dev
```

Set it in `google-api-config.js`:

```js
youtubeWorkerUrl: "https://vocatube-youtube.YOUR-SUBDOMAIN.workers.dev",
```

The static files can then be hosted on GitHub Pages without a Node server.
