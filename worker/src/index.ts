import { parse as parseYaml } from "yaml";

const MODEL_NAME = "@cf/meta/llama-3.3-70b-instruct" as keyof AiModels;
const MAX_HISTORY_ENTRIES = 12;
const MAX_SPEC_CHARS_FOR_PROMPT = 15000;
const LOCAL_AI_WARNING =
  "Workers AI is unavailable in this environment. Run `wrangler dev --remote` or deploy the Worker to use AI-powered answers.";

type Env = {
  AI?: Ai;
  API_SESSION_DO: DurableObjectNamespace;
};

type CreateSessionRequest = {
  specUrl?: string;
  spec?: string;
  label?: string;
};

type EndpointSummary = {
  method: string;
  path: string;
  operationId?: string;
  description?: string;
  requiredParams: string[];
};

type ChatHistoryEntry = {
  role: "user" | "assistant";
  content: string;
  ts: string;
};

type SessionInfo = {
  title?: string;
  version?: string;
  description?: string;
  servers: string[];
  authSchemes: string[];
  label?: string;
};

type SessionState = {
  id: string;
  createdAt: string;
  summary: string;
  specText: string;
  specDigest: string;
  endpoints: EndpointSummary[];
  history: ChatHistoryEntry[];
  favorites: string[];
  info: SessionInfo;
};

function hasAiBinding(env: Env): env is Env & { AI: Ai } {
  return typeof env.AI?.run === "function";
}

type DurableObjectRequest =
  | { op: "init"; state: SessionState }
  | { op: "get-state" }
  | { op: "chat"; message: string }
  | { op: "history" }
  | { op: "favorite"; method: string; path: string };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204, headers: corsHeaders }));
    }

    try {
      const response = await handleRequest(request, env);
      return withCors(response);
    } catch (error) {
      console.error("Unhandled error", error);
      return withCors(
        jsonResponse(
          { error: "Internal Server Error", details: error instanceof Error ? error.message : String(error) },
          500
        )
      );
    }
  }
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/" && request.method === "GET") {
    return new Response(
      [
        "API Copilot Worker is running.",
        "POST /api/session with a specUrl or spec payload to create a session.",
        "Then POST /api/session/:id/chat to ask grounded questions about that API."
      ].join("\n"),
      { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  if (url.pathname === "/favicon.ico") {
    return new Response(null, { status: 204 });
  }

  if (url.pathname === "/healthz") {
    return new Response("ok", { status: 200 });
  }

  if (url.pathname === "/api/session" && request.method === "POST") {
    return handleCreateSession(request, env);
  }

  const sessionMatch = url.pathname.match(/^\/api\/session\/([^/]+)(?:\/(.*))?$/);
  if (!sessionMatch) {
    return jsonResponse({ error: "Not Found" }, 404);
  }

  const sessionId = sessionMatch[1];
  const tail = sessionMatch[2] ?? "";

  switch (request.method) {
    case "GET":
      if (tail === "" || tail === "state") {
        return proxyToDurableObject(sessionId, { op: "get-state" }, env);
      }
      if (tail === "history") {
        return proxyToDurableObject(sessionId, { op: "history" }, env);
      }
      break;
    case "POST":
      if (tail === "chat") {
        return handleChat(sessionId, request, env);
      }
      if (tail === "favorites") {
        return handleFavorite(sessionId, request, env);
      }
      break;
    default:
      break;
  }

  return jsonResponse({ error: "Unsupported route" }, 404);
}

async function handleCreateSession(request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody<CreateSessionRequest>(request);
  if (!body || (!body.specUrl && !body.spec)) {
    return jsonResponse({ error: "Provide specUrl or spec" }, 400);
  }

  try {
    const specText = body.spec ?? (await fetchSpecFromUrl(body.specUrl!));
    const specSnippetForStorage = truncateSpec(specText);
    const parsed = parseOpenApiDocument(specText);
    const specDigest = buildSpecDigest(parsed);
    const summary = await summarizeSpec(specDigest, parsed, env);

    const sessionId = crypto.randomUUID();
    const state: SessionState = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      summary,
      specText: specSnippetForStorage,
      specDigest,
      endpoints: parsed.endpoints,
      history: [],
      favorites: [],
      info: {
        title: parsed.info.title,
        version: parsed.info.version,
        description: parsed.info.description,
        servers: parsed.servers,
        authSchemes: parsed.securitySchemes,
        label: body.label
      }
    };

    console.log("[session:create] initializing DO", sessionId);
    await proxyToDurableObject(sessionId, { op: "init", state }, env);

    return jsonResponse({
      sessionId,
      summary,
      endpoints: parsed.endpoints,
      info: state.info,
      createdAt: state.createdAt
    });
  } catch (error) {
    return jsonResponse(
      { error: "Failed to process spec", details: error instanceof Error ? error.message : String(error) },
      400
    );
  }
}

async function handleChat(sessionId: string, request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody<{ message?: string }>(request);
  if (!body?.message) {
    return jsonResponse({ error: "Missing message" }, 400);
  }

  return proxyToDurableObject(sessionId, { op: "chat", message: body.message }, env);
}

async function handleFavorite(sessionId: string, request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody<{ method?: string; path?: string }>(request);
  if (!body?.method || !body?.path) {
    return jsonResponse({ error: "method and path are required" }, 400);
  }
  return proxyToDurableObject(sessionId, { op: "favorite", method: body.method, path: body.path }, env);
}

async function proxyToDurableObject(sessionId: string, payload: DurableObjectRequest, env: Env): Promise<Response> {
  const id = env.API_SESSION_DO.idFromName(sessionId);
  const stub = env.API_SESSION_DO.get(id);
  const res = await stub.fetch("https://session/", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return res;
}

async function fetchSpecFromUrl(specUrl: string): Promise<string> {
  const url = new URL(specUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Spec URL must be http(s)");
  }
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Unable to fetch spec: ${res.status}`);
  }
  const text = await res.text();
  if (!text.trim()) {
    throw new Error("Spec document is empty");
  }
  return text;
}

type ParsedSpec = {
  info: { title?: string; version?: string; description?: string };
  servers: string[];
  securitySchemes: string[];
  endpoints: EndpointSummary[];
};

function parseOpenApiDocument(specText: string): ParsedSpec {
  let parsed: any;
  try {
    parsed = JSON.parse(specText);
  } catch {
    parsed = parseYaml(specText);
  }

  if (!parsed || typeof parsed !== "object" || !parsed.paths) {
    throw new Error("Invalid OpenAPI document");
  }

  const endpoints: EndpointSummary[] = [];
  const methodKeys = ["get", "post", "put", "patch", "delete", "options", "head"];

  for (const [path, operations] of Object.entries<any>(parsed.paths ?? {})) {
    for (const method of methodKeys) {
      const operation = operations?.[method];
      if (!operation) {
        continue;
      }
      endpoints.push({
        method: method.toUpperCase(),
        path,
        operationId: operation.operationId,
        description: operation.summary ?? operation.description,
        requiredParams: collectRequiredParams(operation)
      });
    }
  }

  const servers = Array.isArray(parsed.servers)
    ? parsed.servers.map((s: any) => s?.url).filter((value: unknown): value is string => Boolean(value))
    : [];

  const securitySchemes = parsed?.components?.securitySchemes
    ? Object.keys(parsed.components.securitySchemes)
    : [];

  return {
    info: parsed.info ?? {},
    servers,
    securitySchemes,
    endpoints
  };
}

function collectRequiredParams(operation: any): string[] {
  const required: string[] = [];
  if (Array.isArray(operation.parameters)) {
    for (const param of operation.parameters) {
      if (param?.required && param?.name) {
        required.push(`${param.in ?? "query"}:${param.name}`);
      }
    }
  }

  const requestBody = operation.requestBody?.content;
  if (requestBody && typeof requestBody === "object") {
    const jsonSchema = requestBody["application/json"]?.schema;
    if (jsonSchema?.required && Array.isArray(jsonSchema.required)) {
      required.push(...jsonSchema.required.map((key: string) => `body:${key}`));
    }
  }

  return Array.from(new Set(required));
}

function buildSpecDigest(parsed: ParsedSpec): string {
  const lines = parsed.endpoints.slice(0, 20).map((ep) => {
    const desc = ep.description ? ` - ${ep.description}` : "";
    return `${ep.method} ${ep.path}${desc}`;
  });

  return [
    `API: ${parsed.info.title ?? "Unknown"} v${parsed.info.version ?? "?"}`,
    parsed.info.description ?? "",
    `Servers: ${parsed.servers.join(", ") || "not declared"}`,
    `Security: ${parsed.securitySchemes.join(", ") || "none defined"}`,
    "Sample endpoints:",
    ...lines
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFallbackSummary(parsed: ParsedSpec, digest: string): string {
  const title = parsed.info.title ?? "API";
  return [
    `Workers AI summary unavailable for ${title}.`,
    "Showing a locally generated digest instead so you can keep building:",
    "",
    digest
  ]
    .filter(Boolean)
    .join("\n");
}

async function summarizeSpec(digest: string, parsed: ParsedSpec, env: Env): Promise<string> {
  const fallback = buildFallbackSummary(parsed, digest);
  if (!hasAiBinding(env)) {
    console.warn("AI binding unavailable; returning fallback summary.");
    return fallback;
  }

  const prompt = [
    "Summarize the following OpenAPI specification for a developer.",
    "Highlight authentication schemes, the most critical endpoints, and any quotas/limits mentioned.",
    "Respond with 3-4 bullet points and include a short tip on how to get started.",
    "",
    digest
  ].join("\n");

  try {
    const response = await env.AI.run(MODEL_NAME, {
      messages: [
        {
          role: "system",
          content:
            "You turn API specifications into concise onboarding notes for experienced developers. Prefer actionable bullet points."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.15,
      max_output_tokens: 400
    });

    const text = extractResponseText(response);
    return text || `Summary unavailable for ${parsed.info.title ?? "API"}.`;
  } catch (error) {
    console.warn("AI summary failed; returning fallback digest instead.", error);
    return fallback;
  }
}

function extractResponseText(aiResponse: any): string {
  if (!aiResponse) return "";
  if (typeof aiResponse === "string") return aiResponse;
  if ("response" in aiResponse && typeof aiResponse.response === "string") {
    return aiResponse.response;
  }
  if ("result" in aiResponse && typeof aiResponse.result === "string") {
    return aiResponse.result;
  }
  if (Array.isArray(aiResponse)) {
    return aiResponse.join("\n");
  }
  return "";
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function readJsonBody<T>(request: Request): Promise<T | undefined> {
  if (!request.body) {
    return undefined;
  }
  const text = await request.text();
  if (!text) {
    return undefined;
  }
  return JSON.parse(text) as T;
}

function buildSystemPrompt(state: SessionState): string {
  const serverLine = state.info.servers.length ? `Servers: ${state.info.servers.join(", ")}` : "Servers: not defined";
  const authLine =
    state.info.authSchemes.length > 0
      ? `Auth: ${state.info.authSchemes.join(", ")}`
      : "Auth: no security schemes declared";
  const favorites =
    state.favorites.length > 0
      ? `Favorite endpoints: ${state.favorites.join(", ")}`
      : "Favorite endpoints: not set yet.";
  return [
    "You are API Copilot, an expert assistant for understanding and using APIs.",
    "Always reason from the provided OpenAPI specification. If something is unclear, explain what additional info is needed.",
    serverLine,
    authLine,
    favorites,
    "Provide runnable cURL or Node.js fetch snippets when useful.",
    "If the user asks for auth, mention the scheme and headers that must be included."
  ].join("\n");
}

function truncateSpec(specText: string): string {
  if (specText.length <= MAX_SPEC_CHARS_FOR_PROMPT) {
    return specText;
  }
  return `${specText.slice(0, MAX_SPEC_CHARS_FOR_PROMPT)}\n... [truncated spec]`;
}

function makeEndpointKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function pruneHistory(history: ChatHistoryEntry[]): ChatHistoryEntry[] {
  if (history.length <= MAX_HISTORY_ENTRIES) {
    return history;
  }
  return history.slice(history.length - MAX_HISTORY_ENTRIES);
}

export class ApiSessionDO {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const payload = await readJsonBody<DurableObjectRequest>(request);
      if (!payload) {
        return jsonResponse({ error: "Empty DO payload" }, 400);
      }
      console.log("[do] op", payload.op);
      switch (payload.op) {
        case "init":
          await this.state.storage.put("state", payload.state);
          return jsonResponse({ ok: true });
        case "get-state":
          return this.returnState();
        case "history":
          return this.returnHistory();
        case "chat":
          return this.runChat(payload.message);
        case "favorite":
          return this.toggleFavorite(payload.method, payload.path);
        default:
          return jsonResponse({ error: "Unknown DO op" }, 400);
      }
    } catch (error) {
      console.error("[do] failure", error);
      return jsonResponse(
        { error: "DO failure", details: error instanceof Error ? error.message : String(error) },
        500
      );
    }
  }

  private async getState(): Promise<SessionState | undefined> {
    return (await this.state.storage.get<SessionState>("state")) ?? undefined;
  }

  private async returnState(): Promise<Response> {
    const state = await this.getState();
    if (!state) {
      return jsonResponse({ error: "Session not initialized" }, 404);
    }
    const { specText, ...rest } = state;
    return jsonResponse(rest);
  }

  private async returnHistory(): Promise<Response> {
    const state = await this.getState();
    if (!state) {
      return jsonResponse({ error: "Session not initialized" }, 404);
    }
    return jsonResponse({ history: state.history });
  }

  private async runChat(message: string): Promise<Response> {
    const state = await this.getState();
    if (!state) {
      console.warn("[do] chat before init");
      return jsonResponse({ error: "Session not initialized" }, 404);
    }

    if (!hasAiBinding(this.env)) {
      return jsonResponse({
        reply: LOCAL_AI_WARNING,
        history: state.history,
        favorites: state.favorites,
        info: state.info
      });
    }

    const systemPrompt = buildSystemPrompt(state);
    const specSnippet = truncateSpec(state.specText);
    const userPrompt = [
      "Use the OpenAPI excerpt and session summary below to answer the question.",
      "When citing endpoints, reference their method and path.",
      "",
      "OpenAPI excerpt:",
      specSnippet,
      "",
      "Session summary:",
      state.summary,
      "",
      `Question: ${message}`
    ].join("\n");

    const messages = [
      { role: "system", content: systemPrompt },
      ...state.history.map((entry) => ({ role: entry.role, content: entry.content })),
      { role: "user", content: userPrompt }
    ];

    try {
      const aiResponse = await this.env.AI.run(MODEL_NAME, {
        messages,
        temperature: 0.1,
        max_output_tokens: 700
      });

      const reply = extractResponseText(aiResponse) || "I could not generate a helpful answer.";
      const now = new Date().toISOString();
      const updatedHistory = pruneHistory([
        ...state.history,
        { role: "user", content: message, ts: now },
        { role: "assistant", content: reply, ts: now }
      ]);

      const updatedState: SessionState = { ...state, history: updatedHistory };
      await this.state.storage.put("state", updatedState);

      return jsonResponse({
        reply,
        history: updatedHistory,
        favorites: state.favorites,
        info: state.info
      });
    } catch (error) {
      console.error("AI chat failed", error);
      const details = error instanceof Error ? error.message : String(error);
      return jsonResponse({
        reply: `${LOCAL_AI_WARNING}\n\nDetails: ${details}`,
        history: state.history,
        favorites: state.favorites,
        info: state.info
      });
    }
  }

  private async toggleFavorite(method: string, path: string): Promise<Response> {
    const state = await this.getState();
    if (!state) {
      return jsonResponse({ error: "Session not initialized" }, 404);
    }

    const key = makeEndpointKey(method, path);
    let favorites = state.favorites;
    if (favorites.includes(key)) {
      favorites = favorites.filter((entry) => entry !== key);
    } else {
      favorites = [...favorites, key];
    }

    const updatedState: SessionState = { ...state, favorites };
    await this.state.storage.put("state", updatedState);
    return jsonResponse({ favorites });
  }
}

