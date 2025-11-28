# PROMPTS

Cloudflare asks us to document any AI prompts we leaned on. Instead of pasting a sterile transcript, here’s the actual playbook I gave GPT.

---

## Prompt 1 – “Set the vision”

> I want an “API Copilot on the Edge.” Non-negotiables:  
> • Accept an OpenAPI URL *or* raw spec.  
> • Stack = Worker, Durable Object, Workers AI (`@cf/meta/llama-3.3-70b-instruct`), Pages UI.  
> • Behavior = fetch spec, summarize, list endpoints, persist chat + favorites, answer “How do I…?” using grounded context.  
> • Constraints = repo name starts with `cf_ai_`, include README + PROMPTS, only depend on Cloudflare services.  
> Deliverables = product narrative, success metrics, rollout checklist.

---

## Prompt 2 – “Blueprint before code”

> Lay out the whole system:  
> 1. Worker routes, CORS stance, error shapes.  
> 2. Durable Object schema + how we cap history.  
> 3. Exact Workers AI prompt scaffolding.  
> 4. Pages data flow, localStorage rules, fetch patterns.  
> 5. Dev ergonomics: wrangler scripts, `/` + `/healthz`, local vs remote AI story.  
> Include binding names, data models, and token-budget tricks (spec truncation, history pruning). Finish with a validation checklist so future-me can regression test fast.

---

## Prompt 3 – “Give me the build plan”
 
>  Break implementation into dependency-ordered steps covering:  
> • Worker skeleton for `/`, `/healthz`, `/api/session`, `/api/session/:id/*`.  
> • Durable Object ops (`init`, `get-state`, `history`, `chat`, `favorite`).  
> • Spec ingestion (fetch, parse JSON/YAML, digest, AI summary fallback).  
> • Chat flow with history trimming and Workers AI call.  
> • Pages UI flow (spec form, chat form, favorites toggle, status messaging).  
> • Error UX (bubble up `details`, warn when AI isn’t available).  
> Each step should list the goal, files touched, and a quick check to verify it works.

---

## Prompt 4 – “Polish it for demo day”
  
> Tell me the finishing touches that make this demo feel intentional:  
> • Copy for the Worker landing text and Pages hero/status messages.  
> • README structure that explains local vs remote AI expectations and the dev scripts.  
> • How to message digest-only fallback when running `wrangler dev --local`.  
> • Any other nice touches (favorites UX, demo checklist).  
> Give concrete wording and env var names so I can drop them straight into the project.