# cf_ai_api_copilot

API Copilot on the Edge is a Cloudflare-native assistant that ingests any OpenAPI/Swagger document, stores a working memory in a Durable Object, and exposes a chat UI on Pages to answer “How do I…?” questions about the target API. The Worker orchestrates Workers AI (Llama 3.3) with durable storage so that each API session remembers summaries, endpoint metadata, and favorites.

## Why this exists

- **Problem**: API teams hand out sprawling OpenAPI files, but consumers still have to skim hundreds of endpoints, guess which server to hit, and ask “what auth header do I need?” in Slack.
- **Solution**: Drop the spec URL into this Worker. It summarizes the spec, highlights key endpoints, and lets you chat follow-up questions that are grounded in the stored document.
- **What you get**: Persistent sessions with digest, chat history, and favorite endpoints; copy‑pasteable cURL/fetch snippets; and a Pages UI so non-Worker folks can use it too—all hosted entirely on Cloudflare.

## Architecture

- **LLM** – Workers AI `@cf/meta/llama-3.3-70b-instruct` for spec summaries and conversational answers.
- **Workflow / coordination** – A Cloudflare Worker (`worker/src/index.ts`) routes HTTP calls, streams specs into the Durable Object, and manages AI prompts.
- **Memory / state** – `ApiSessionDO` Durable Object keeps the raw spec, computed digest, chat history, and user favorites per session.
- **UI** – Cloudflare Pages app in `pages/` (vanilla JS) that lets engineers paste a spec URL, review the digest, and chat with the agent.
- **Developer ergonomics** – The Worker serves a friendly root page (`GET /`) plus `/healthz` for probes, and it falls back to digest-only summaries whenever Workers AI is unavailable (e.g., during purely local development).

```
User ↔ Pages UI (fetch)
          ↘
         Worker  ──> Workers AI (summaries + chat completions)
            │
            └─> Durable Object (spec digest, chat history, favorites)
```

## Getting started

### Prerequisites

- Node.js 18+
- Wrangler (installed locally via devDependency). Run `npx wrangler login` once to link your account.
- A Cloudflare account with Workers AI enabled in the desired account

### 1. Install Worker deps & run locally

```bash
cd worker
npm install
npm run dev   # or npx wrangler dev
# Run npm run dev:remote if you need actual Workers AI responses
```

This spins up the Worker + Durable Object locally at `http://localhost:8787`.
> Note: Workers AI bindings are unavailable in `--local` mode. The Worker falls back to a digest-only summary locally, but run `npm run dev:remote` (or `npx wrangler dev --remote`) whenever you want end-to-end AI answers.

#### Local vs remote Workers AI

- `npm run dev` (Miniflare) – zero external calls, ideal for iterating on routing and UI. Spec digest + metadata still work, and any chat attempts respond with an explanatory warning.
- `npm run dev:remote` – runs the Worker on Cloudflare’s edge so Workers AI is fully available. Required for true LLM summaries/chats.
- `wrangler deploy` – same behavior as `dev:remote`, but production.

### 2. Deploy the Worker

```bash
wrangler deploy
```

> The supplied `wrangler.toml` already binds Workers AI (`AI`) and the `ApiSessionDO`. The first deploy will run the included migration and provision the Durable Object.

### 3. Use the API

- `POST /api/session` `{ "specUrl": "https://..." }` – fetches the spec, stores its digest, and returns `sessionId`, summary, and endpoints.
- `POST /api/session/:id/chat` `{ "message": "How do I create a user?" }` – conversational answers grounded in the stored spec.
- `POST /api/session/:id/favorites` – toggle `method + path` favorites.
- `GET /api/session/:id/history|state` – retrieve stored memory (sanitized without raw spec text).
- `GET /` – quick readiness text with usage tips; `GET /healthz` – simple `ok` for probes.

Example:

```bash
curl -X POST http://localhost:8787/api/session \
  -H "content-type: application/json" \
  -d '{ "specUrl": "https://petstore.swagger.io/v2/swagger.json" }'
```

### 4. Develop & deploy the Pages UI

- **Local preview**

```bash
# from repo root
npx wrangler pages dev pages
```

By default the UI talks to the deployed Worker (`https://cf-ai-api-copilot.griffinstanui99.workers.dev`). If you want it to hit a local Worker instead, edit the `API_BASE` constant near the top of `pages/app.js` before running the command.

- **Deploy**
  1. Create a Pages project pointing at the `pages/` directory.
  2. Deploy. The frontend reads the Worker URL from the `API_BASE` constant in `pages/app.js`, so update that value before publishing if your Worker hostname changes.

## Project structure

- `worker/src/index.ts` – Worker entrypoint, spec fetcher, Durable Object orchestration, and AI prompts.
- `worker/wrangler.toml` – bindings for `AI` and `ApiSessionDO` + migration.
- `pages/index.html|styles.css|app.js` – Pages chat surface with spec loader, digest, favorites, and chat log.
- `PROMPTS.md` – AI prompts used in this submission.

## Memory & safety

- Durable Object storage keeps the raw spec, digest, chat history (last 12 turns), and endpoint favorites per session, enabling contextual memory for every call.
- Each chat request reuses the stored history and spec snippet so the LLM can answer follow-ups about prior steps.
- Truncation safeguards limit OpenAPI content injected into prompts to ~15k characters while keeping the complete spec persisted in storage for future summarization or export.

## Next steps

- Add embedding-assisted semantic search over endpoints for better grounding.
- Allow raw JSON/YAML uploads directly from the Pages UI.
- Stream Workers AI responses to the frontend for faster perceived latency.
- Expand offline/dev ergonomics further by mocking AI responses for scripted tests.

## Deployment checklist

1. `cd worker && npm install && wrangler deploy`
2. Create Pages project → Framework preset “None” (static) → directory `pages`
3. Update `pages/app.js` with the correct Worker URL before publishing the Pages build
4. Commit + push → share repo URL prefixed with `cf_ai_`

Happy demoing! 🎛️

