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
- Cloudflare account with Workers AI enabled
- `wrangler` (`npm i -D wrangler` + `npx wrangler login`)

### 1. Worker API (local & remote)

```bash
cd worker
npm install

# local dev, mock AI
npm run dev

# remote dev (hits Workers AI)
npm run dev:remote

# deploy
npm run deploy
```

Endpoints:

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/session` | Fetch & store spec via URL or raw string |
| `POST` | `/api/session/:id/chat` | Ask a grounded question |
| `POST` | `/api/session/:id/favorites` | Toggle favorite endpoints |
| `GET` | `/api/session/:id/state` | Session metadata (no raw spec) |
| `GET` | `/healthz` | Health probe |

### 2. Cloudflare Pages UI

**Local preview**

```bash
npx wrangler pages dev pages --binding CF_API_BASE=http://localhost:8787
```

**Deploy**

1. Create a Pages project targeting `pages/`
2. Set `CF_API_BASE = https://your-worker.workers.dev`
3. `npx wrangler pages deploy pages`

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
3. Ensure the Pages env variable `CF_API_BASE` is set before publishing the Pages build
4. Commit + push → share repo URL prefixed with `cf_ai_`

Happy demoing! 🎛️

