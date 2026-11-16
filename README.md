# Antigravity API

Express + TypeScript proxy that serves an OpenAI-compatible API (`/v1/models`, `/v1/chat/completions`)
on top of Google Antigravity accounts, with account rotation and a quota dashboard at `/`.

## Layout

```
src/
  config.ts              client version / User-Agent, base URLs, limits (env-driven)
  app.ts, server.ts      wiring
  routes/openai.ts       /v1/models, /v1/chat/completions (rotation, failure handling)
  routes/management.ts   /api/* (accounts, import, OAuth, overview, live catalogue)
  services/container.ts  shared store, rotation, tokens, client, catalogue, quota
  services/overview.ts   dashboard overview (pool capacity, refill schedule)
  accounts/              auth files on disk, rotation, token refresh
  proxy/client.ts        v1internal generateContent / streamGenerateContent (SSE)
  proxy/format/          OpenAI <-> Antigravity request and response mapping
  proxy/errors.ts        what an upstream failure means for routing
  proxy/models.ts        static model list and aliases
  proxy/catalog.ts       live catalogue from fetchAvailableModels
  oauth/                 Google sign-in flows (redirect, device code, manual paste)
  web/                   React dashboard (built to dist-web)
```

## Behaviour worth knowing

- **Client version.** Google gates model families on the version in the User-Agent. Set it with
  `ANTIGRAVITY_VERSION` (default `2.32.0`); check `GET /api/models/upstream?refresh=1` after a bump.
- **Model list.** `/v1/models` is the live `fetchAvailableModels` catalogue (minus tab/internal models,
  legacy aliases and retired models) plus Claude 5.5, which answers on entitled accounts but is not listed.
  Unknown model ids are passed through unchanged; nothing is silently swapped for another model.
- **Bans.** A `403 … disabled in this account for violation of Terms of Service` marks the account
  `banned` in its auth file; it is never routed to again until `POST /api/accounts/:id/enable`.
- **Bare 429.** `429 Resource has been exhausted (e.g. check quota).` with no quota details is Antigravity
  refusing the request itself, not quota. After two accounts answer that way the proxy stops and returns
  `429 upstream_rejected` instead of walking the whole pool.
- **Retired models** (answering only "X is no longer available. Please switch to Y") return `410`,
  including in streaming mode.
- Reasoning parts are returned as `reasoning_content`, not mixed into `content`.

## Local dev

```bash
npm install
npm test
npm run build
MANAGEMENT_TOKEN=admin API_KEYS=client AUTH_DIR=./data/auth npm run dev
```

## Deploy (home server)

The service runs as Docker Swarm service `antigravity-api-5111` with `/root/projects/antigravity-api/data`
mounted at `/app/data`:

```bash
docker build -t antigravity-api-5111:latest .
docker service update --force --image antigravity-api-5111:latest antigravity-api-5111
```

## API examples

```bash
curl -H 'Authorization: Bearer admin' http://localhost:5111/api/accounts/overview
curl -H 'Authorization: Bearer admin' 'http://localhost:5111/api/models/upstream?refresh=1'
curl -H 'Authorization: Bearer client' http://localhost:5111/v1/models
```
