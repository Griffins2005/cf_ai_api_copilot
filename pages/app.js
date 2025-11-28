const specForm = document.getElementById("spec-form");
const specInput = document.getElementById("spec-url");
const specStatus = document.getElementById("spec-status");
const summaryContent = document.getElementById("summary-content");
const endpointList = document.getElementById("endpoint-list");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatLog = document.getElementById("chat-log");

let currentSessionId = null;
let knownFavorites = new Set();

function getApiBase() {
  const value =
    typeof window !== "undefined" &&
    window.CF_API_BASE &&
    window.CF_API_BASE.trim().replace(/\/$/, "");
  if (!value) {
    throw new Error("CF_API_BASE is not configured. Set the Pages env var before deploying.");
  }
  return value;
}

specForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = specInput.value.trim();
  if (!url) return;
  setSpecStatus("Fetching spec...");
  toggleForm(specForm, true);
  try {
    const res = await fetch(`${getApiBase()}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ specUrl: url })
    });
    if (!res.ok) {
      const message = await responseErrorMessage(res, `Failed to load spec (${res.status})`);
      throw new Error(message);
    }
    const data = await res.json();
    currentSessionId = data.sessionId;
    knownFavorites = new Set(data.favorites ?? []);
    setSpecStatus(`Loaded ${data.info?.title ?? "API"} • session ${currentSessionId}`);
    renderSummary(data.summary, data.info);
    renderEndpoints(data.endpoints ?? []);
    resetChat();
  } catch (error) {
    console.error(error);
    setSpecStatus(error.message);
  } finally {
    toggleForm(specForm, false);
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  if (!currentSessionId) {
    setSpecStatus("Load a spec before chatting.");
    return;
  }
  chatInput.value = "";
  appendMessage("user", message);
  appendMessage("assistant", "_Thinking with Workers AI…_");
  try {
    const res = await fetch(`${getApiBase()}/api/session/${currentSessionId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message })
    });
    if (!res.ok) {
      const message = await responseErrorMessage(res, `Chat failed (${res.status})`);
      throw new Error(message);
    }
    const data = await res.json();
    knownFavorites = new Set(data.favorites ?? []);
    replaceLastAssistantMessage(data.reply ?? "(no answer)");
  } catch (error) {
    console.error(error);
    replaceLastAssistantMessage(`Error: ${error.message}`);
  }
});

function renderSummary(summary, info = {}) {
  summaryContent.classList.remove("placeholder");
  const parts = [
    info.title ? `**${info.title}**` : "",
    info.version ? `Version: ${info.version}` : "",
    info.servers?.length ? `Servers: ${info.servers.join(", ")}` : "",
    info.authSchemes?.length ? `Auth: ${info.authSchemes.join(", ")}` : ""
  ].filter(Boolean);

  summaryContent.innerHTML = renderMarkdown(summary ?? "Summary unavailable");
  if (parts.length) {
    const meta = document.createElement("p");
    meta.innerHTML = parts.join(" • ");
    summaryContent.prepend(meta);
  }
}

function renderEndpoints(endpoints) {
  endpointList.innerHTML = "";
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    endpointList.textContent = "No endpoints detected.";
    return;
  }

  endpoints.slice(0, 30).forEach((ep) => {
    const card = document.createElement("div");
    card.className = "endpoint";

    const header = document.createElement("div");
    header.innerHTML = `<span class="method">${ep.method}</span> ${ep.path}`;
    card.appendChild(header);

    if (ep.description) {
      const desc = document.createElement("p");
      desc.textContent = ep.description;
      card.appendChild(desc);
    }

    const button = document.createElement("button");
    button.textContent = favoriteLabel(ep.method, ep.path);
    button.addEventListener("click", () => toggleFavorite(ep.method, ep.path, button));
    card.appendChild(button);

    endpointList.appendChild(card);
  });
}

async function toggleFavorite(method, path, buttonEl) {
  if (!currentSessionId) {
    setSpecStatus("Load a spec first.");
    return;
  }
  buttonEl.disabled = true;
  try {
    const res = await fetch(`${getApiBase()}/api/session/${currentSessionId}/favorites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, path })
    });
    if (!res.ok) {
      const message = await responseErrorMessage(res, "Failed to update favorites");
      throw new Error(message);
    }
    const data = await res.json();
    knownFavorites = new Set(data.favorites ?? []);
    buttonEl.textContent = favoriteLabel(method, path);
  } catch (error) {
    console.error(error);
    setSpecStatus(error.message);
  } finally {
    buttonEl.disabled = false;
  }
}

function favoriteLabel(method, path) {
  const key = `${method.toUpperCase()} ${path}`;
  return knownFavorites.has(key) ? "★ Unfavorite" : "☆ Favorite";
}

function appendMessage(role, content) {
  const el = document.createElement("div");
  el.className = `chat-message ${role}`;
  el.innerHTML = renderMarkdown(content);
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function replaceLastAssistantMessage(content) {
  const nodes = [...chatLog.querySelectorAll(".chat-message.assistant")];
  const last = nodes[nodes.length - 1];
  if (last) {
    last.innerHTML = renderMarkdown(content);
  } else {
    appendMessage("assistant", content);
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

function resetChat() {
  chatLog.innerHTML = "";
  appendMessage("assistant", "Spec loaded. Ask anything about this API.");
}

function setSpecStatus(message) {
  specStatus.textContent = message;
}

function toggleForm(form, disabled) {
  form.querySelectorAll("input, button").forEach((el) => {
    el.disabled = disabled;
  });
}

function renderMarkdown(text) {
  if (typeof mdParser === "undefined" || typeof mdParser.parse !== "function") {
    return escapeHtml(text ?? "");
  }
  return mdParser.parse(text ?? "");
}

async function responseErrorMessage(response, fallback) {
  try {
    const text = await response.clone().text();
    if (!text) {
      return fallback;
    }
    try {
      const data = JSON.parse(text);
      return data?.details || data?.error || text || fallback;
    } catch {
      return text;
    }
  } catch {
    return fallback;
  }
}

function escapeHtml(value = "") {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Lightweight markdown parser fallback
const mdParser = window.marked || {
  parse(input) {
    return escapeHtml(input).replace(/\n/g, "<br />");
  }
};

