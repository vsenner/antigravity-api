# Antigravity API

Lean Express + TypeScript API/dashboard for Antigravity account routing.

## Features

- Docker-ready Express server
- `GET /api/accounts` management endpoint
- `GET /api/stats/summary`
- OpenAI-compatible shell:
  - `GET /v1/models`
  - `POST /v1/chat/completions`
- Round-robin account rotation
- Cooldown after repeated failures
- Minimal built-in dashboard at `/`
- Reads auth files from `AUTH_DIR` (`/app/config/auth` in Docker)

## Current proxy mode

The server already performs account selection, auth loading, retries/cooldown accounting and OpenAI-compatible route handling.

For actual upstream forwarding set:

```env
ANTIGRAVITY_OPENAI_COMPAT_URL=http://existing-compatible-upstream:8080
```

If this is unset, `/v1/chat/completions` returns a clear error. The next implementation step is porting the native Antigravity request adapter from the Go `cockpit-cliproxy` code into `src/proxy/antigravity-client.ts`.

## Local dev

```bash
npm install
npm test
npm run build
MANAGEMENT_TOKEN=admin API_KEYS=client AUTH_DIR=/root/cockpit-config/auth npm run dev
```

## Docker

```bash
docker build -t antigravity-api:latest .
docker run --rm -p 3000:3000 \
  -e MANAGEMENT_TOKEN=admin \
  -e API_KEYS=client \
  -e AUTH_DIR=/app/config/auth \
  -v /root/cockpit-config/auth:/app/config/auth:ro \
  antigravity-api:latest
```

## API examples

```bash
curl -H 'Authorization: Bearer admin' http://localhost:3000/api/accounts
curl -H 'Authorization: Bearer admin' http://localhost:3000/api/stats/summary
curl -H 'Authorization: Bearer client' http://localhost:3000/v1/models
```
