const STORAGE_KEY = "teman-rencana-v1";

const TONE_PARAMETERS = {
  santai: { temperature: 0.9, topP: 0.95, topK: 40 },
  formal: { temperature: 0.3, topP: 0.8, topK: 20 },
};

const form = document.querySelector("#chat-form");
const input = document.querySelector("#user-input");
const chatBox = document.querySelector("#chat-box");
const emptyState = document.querySelector("#chat-empty");
const parametersNode = document.querySelector("#parameters");
const profileNode = document.querySelector("#profile");
const clearButton = document.querySelector("#clear-chat");
const settingsButton = document.querySelector("#open-settings");
const settingsModal = document.querySelector("#settings-modal");
const closeSettingsButton = document.querySelector("#close-settings");
const toneButtons = document.querySelectorAll("[data-tone]");
const themeButtons = document.querySelectorAll("[data-theme-choice]");
const suggestionButtons = document.querySelectorAll("[data-suggestion]");
const nameInput = document.querySelector("#display-name");
const greeting = document.querySelector("#greeting");
const hello = document.querySelector("#hello");
const composerNote = document.querySelector("#composer-note");

const state = loadState();

function emptyStateData() {
  return {
    tone: "santai",
    profile: { city: "", budget: "", preference: "" },
    messages: [],
    itinerary: null,
    weather: null,
    parameters: TONE_PARAMETERS.santai,
    model: "",
    name: "",
    theme: "light",
    lastRequest: null,
  };
}

function loadState() {
  const fallback = emptyStateData();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return fallback;
    return {
      ...fallback,
      ...saved,
      tone: saved.tone === "formal" ? "formal" : "santai",
      theme: saved.theme === "dark" ? "dark" : "light",
      name: typeof saved.name === "string" ? saved.name.slice(0, 40) : "",
      profile: {
        city: saved.profile?.city || "",
        budget: saved.profile?.budget || "",
        preference: saved.profile?.preference || "",
      },
      messages: Array.isArray(saved.messages) ? saved.messages.slice(-40) : [],
      lastRequest: inferLastRequest(saved),
    };
  } catch {
    return fallback;
  }
}

function inferLastRequest(saved) {
  const stored = normalizeLastRequest(saved.lastRequest);
  if (stored) return stored;
  const messages = Array.isArray(saved.messages) ? saved.messages : [];
  const lastUser = [...messages].reverse().find((message) => message?.role === "user");
  if (!lastUser) return null;
  const answered = messages.slice(messages.lastIndexOf(lastUser) + 1).some((message) => message?.role === "model");
  if (!answered) return null;
  return normalizeLastRequest({ text: lastUser.text, tone: saved.tone });
}

function normalizeLastRequest(value) {
  if (!value || typeof value.text !== "string" || !value.text.trim()) return null;
  return {
    text: value.text.trim().toLowerCase(),
    tone: value.tone === "formal" ? "formal" : "santai",
  };
}

function taskKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function uniqueSlots(slots) {
  const seenPlaces = new Set();
  const seenActivities = new Set();
  return slots.filter((slot) => {
    const place = taskKey(slot.place);
    const activity = taskKey(slot.activity);
    if (!activity) return false;
    if ((place && seenPlaces.has(place)) || seenActivities.has(activity)) return false;
    if (place) seenPlaces.add(place);
    seenActivities.add(activity);
    return true;
  });
}

function isDuplicateTask(text) {
  const request = normalizeLastRequest({ text, tone: state.tone });
  return Boolean(
    request &&
    state.lastRequest &&
    state.lastRequest.text === request.text &&
    state.lastRequest.tone === request.tone
  );
}

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tone: state.tone,
        profile: state.profile,
        messages: state.messages.slice(-40),
        itinerary: state.itinerary,
        weather: state.weather,
        parameters: state.parameters,
        model: state.model,
        name: state.name,
        theme: state.theme,
        lastRequest: state.lastRequest,
      })
    );
  } catch {
    // Browser privat bisa menolak penyimpanan. Percakapan tetap jalan di tab ini.
  }
}

function appendMessage(role, text, pending = false) {
  const item = document.createElement("article");
  item.className = `message message-${role === "user" ? "user" : "model"}`;
  if (pending) item.classList.add("is-pending");

  const who = document.createElement("span");
  who.className = "who";
  who.textContent = role === "user" ? "Kamu" : "Teman Rencana";

  const body = document.createElement("p");
  body.textContent = text;

  item.append(who, body);
  chatBox.append(item);
  chatBox.scrollTop = chatBox.scrollHeight;
  return item;
}

function renderMessages() {
  chatBox.querySelectorAll(".message").forEach((node) => node.remove());
  let lastModelNode = null;
  state.messages.forEach((message) => {
    const node = appendMessage(message.role, message.text);
    if (message.role !== "user") lastModelNode = node;
  });
  if (lastModelNode) attachPlan(lastModelNode);
  emptyState.hidden = state.messages.length > 0;
}

function factItem(label, value) {
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value || "Belum ada";
  return [term, detail];
}

function renderParameters() {
  const parameters = state.parameters || TONE_PARAMETERS[state.tone];
  parametersNode.replaceChildren(
    ...factItem("Gaya", state.tone === "formal" ? "Formal" : "Santai"),
    ...factItem("Model", state.model || "Gemini Flash"),
    ...factItem("temperature", String(parameters.temperature)),
    ...factItem("topP", String(parameters.topP)),
    ...factItem("topK", String(parameters.topK))
  );
}

function renderProfile() {
  profileNode.replaceChildren(
    ...factItem("Kota", state.profile.city),
    ...factItem("Budget", state.profile.budget),
    ...factItem("Selera", state.profile.preference)
  );
}

function attachPlan(messageNode) {
  chatBox.querySelectorAll(".plan-card").forEach((card) => card.remove());
  chatBox.querySelectorAll(".has-plan").forEach((node) => node.classList.remove("has-plan"));
  const plan = state.itinerary;
  if (!messageNode || !plan) return;

  const card = document.createElement("div");
  card.className = "plan-card";

  if (state.weather) {
    const weather = document.createElement("p");
    weather.className = "weather-pill";
    const rain = state.weather.rainChance;
    weather.textContent = `${state.weather.temperature}°C · ${state.weather.condition}${
      rain === 0 || rain ? ` · hujan ${rain}%` : ""
    }`;
    card.append(weather);
  }

  if (plan.summary) {
    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = plan.summary;
    card.append(summary);
  }

  if (plan.estimatedCost) {
    const cost = document.createElement("p");
    cost.className = "cost-line";
    cost.textContent = `Perkiraan ${plan.estimatedCost}`;
    card.append(cost);
  }

  uniqueSlots(plan.slots || []).forEach((slot) => {
    const row = document.createElement("article");
    row.className = "slot";

    const time = document.createElement("p");
    time.className = "slot-time";
    time.textContent = slot.time || "Hari";

    const body = document.createElement("div");
    body.className = "slot-body";
    const activity = document.createElement("p");
    activity.textContent = slot.activity || "";
    body.append(activity);

    if (slot.place) {
      const place = document.createElement("p");
      place.className = "slot-place";
      place.textContent = slot.place;
      body.append(place);
    }

    if (slot.cost) {
      const slotCost = document.createElement("p");
      slotCost.className = "slot-cost";
      slotCost.textContent = slot.cost;
      body.append(slotCost);
    }

    row.append(time, body);
    card.append(row);
  });

  messageNode.append(card);
  messageNode.classList.add("has-plan");
}

function openSettings() {
  settingsModal.hidden = false;
  document.body.classList.add("modal-open");
  closeSettingsButton.focus();
}

function closeSettings() {
  if (settingsModal.hidden) return;
  settingsModal.hidden = true;
  document.body.classList.remove("modal-open");
  settingsButton.focus();
}

function renderTone() {
  toneButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.tone === state.tone));
  });
}

function renderTheme() {
  const theme = state.theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "";
  if (theme === "light") delete document.documentElement.dataset.theme;
  themeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === theme));
  });
}

function renderGreeting() {
  const name = state.name.trim();
  greeting.textContent = name
    ? `Halo, ${name}. Sebutkan kota, budget, dan suasana yang kamu mau.`
    : "Sebutkan kota, budget, dan suasana yang kamu mau.";
  hello.hidden = !name;
  hello.textContent = name ? `Halo, ${name}.` : "";
}

function renderName() {
  if (document.activeElement !== nameInput) nameInput.value = state.name;
  renderGreeting();
}

function render() {
  renderTheme();
  renderTone();
  renderName();
  renderParameters();
  renderProfile();
  renderMessages();
}

function setBusy(isBusy) {
  state.sending = isBusy;
  input.disabled = isBusy;
  form.querySelector("button").disabled = isBusy;
  suggestionButtons.forEach((button) => {
    button.disabled = isBusy;
  });
  clearButton.disabled = isBusy;
}

async function sendMessage(text) {
  const userMessage = text.trim();
  if (!userMessage || state.sending) return;

  if (isDuplicateTask(userMessage)) {
    composerNote.textContent = "Permintaan yang sama tidak dikirim ulang. Ubah pesan atau gaya bahasa dulu.";
    return;
  }

  composerNote.textContent = "";
  input.value = "";
  state.messages.push({ role: "user", text: userMessage });
  appendMessage("user", userMessage);
  emptyState.hidden = true;
  saveState();

  const pending = appendMessage("model", "Sedang menyusun rencana...", true);
  setBusy(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation: state.messages,
        tone: state.tone,
        profile: state.profile,
        name: state.name.trim(),
      }),
    });
    const data = await response.json().catch(() => ({}));
    const reply = pending.querySelector("p");

    if (!response.ok || !data.result) {
      reply.textContent = response.ok
        ? "Maaf, tidak ada respons."
        : "Gagal mendapat respons dari server.";
      pending.classList.remove("is-pending");
      pending.classList.add("is-error");
      return;
    }

    reply.textContent = data.result;
    pending.classList.remove("is-pending");
    state.messages.push({ role: "model", text: data.result });
    if (data.profile) state.profile = data.profile;
    state.itinerary = data.itinerary || null;
    state.weather = data.weather || null;
    state.parameters = data.parameters || TONE_PARAMETERS[state.tone];
    state.model = data.model || state.model;
    state.lastRequest = { text: userMessage.toLowerCase(), tone: state.tone };
    saveState();
    renderParameters();
    renderProfile();
    attachPlan(pending);
    chatBox.scrollTop = chatBox.scrollHeight;
  } catch {
    pending.querySelector("p").textContent = "Gagal mendapat respons dari server.";
    pending.classList.remove("is-pending");
    pending.classList.add("is-error");
  } finally {
    setBusy(false);
    if (settingsModal.hidden) input.focus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("input", () => {
  composerNote.textContent = "";
});

nameInput.addEventListener("input", () => {
  state.name = nameInput.value.slice(0, 40);
  saveState();
  renderGreeting();
});

nameInput.addEventListener("blur", () => {
  state.name = state.name.trim().slice(0, 40);
  nameInput.value = state.name;
  saveState();
  renderGreeting();
});

themeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.theme = button.dataset.themeChoice === "dark" ? "dark" : "light";
    saveState();
    renderTheme();
  });
});

toneButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.tone = button.dataset.tone === "formal" ? "formal" : "santai";
    state.parameters = TONE_PARAMETERS[state.tone];
    saveState();
    renderTone();
    renderParameters();
  });
});

suggestionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    sendMessage(button.dataset.suggestion || "");
  });
});

settingsButton.addEventListener("click", openSettings);
closeSettingsButton.addEventListener("click", closeSettings);
settingsModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-modal]")) closeSettings();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSettings();
});

clearButton.addEventListener("click", () => {
  const fresh = emptyStateData();
  state.tone = fresh.tone;
  state.profile = fresh.profile;
  state.messages = [];
  state.itinerary = null;
  state.weather = null;
  state.parameters = fresh.parameters;
  state.model = "";
  state.lastRequest = null;
  composerNote.textContent = "";
  saveState();
  render();
  if (settingsModal.hidden) input.focus();
});

render();
input.focus();
