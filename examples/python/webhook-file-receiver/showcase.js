const byId = (id) => document.getElementById(id);
const state = { events: [] };

function escapeHtml(value) {
  return String(value).replace(
    /[&<>'"]/g,
    (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[character],
  );
}

function toast(message) {
  const element = byId("toast");
  element.textContent = message;
  element.classList.add("show");
  window.setTimeout(() => element.classList.remove("show"), 2600);
}

function render() {
  byId("count").textContent =
    `${String(state.events.length).padStart(2, "0")} EVENTS`;
  if (!state.events.length) return;

  byId("events").innerHTML = state.events
    .map(({ event, receivedAt, downloadUrl, fileContent }) => {
      const type = event?.type || "webhook.received";
      const file = event?.data?.file;
      const filePanel = downloadUrl
        ? `<div class="file-head">
             <span class="eyebrow">Downloaded file · ${escapeHtml(file?.sizeBytes ?? "?")} bytes</span>
             <a class="download" href="${downloadUrl}">↓ ${escapeHtml(file?.filename || "DOWNLOAD FILE")}</a>
           </div>
           ${fileContent == null ? "" : `<pre class="file-preview">${escapeHtml(fileContent)}</pre>`}`
        : "";

      return `<article class="event">
        <div class="event-top">
          <span class="event-dot"></span>
          <span class="event-type">${escapeHtml(type)}</span>
          <time>${new Date(receivedAt).toLocaleTimeString()}</time>
        </div>
        <div class="event-body${downloadUrl ? " has-file" : ""}">
          <pre>${escapeHtml(JSON.stringify(event?.data ?? event, null, 2))}</pre>
          ${filePanel}
        </div>
      </article>`;
    })
    .join("");
}

async function establishSession() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get("access_token");
  if (!token) return;

  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
  if (!response.ok) throw new Error("This showcase link is not authorized");
}

async function load() {
  await establishSession();
  const responses = await Promise.all([
    fetch("/api/config"),
    fetch("/api/triggers"),
    fetch("/api/events"),
  ]);
  if (responses.some((response) => response.status === 401)) {
    throw new Error("Open the complete secure showcase URL from the terminal");
  }
  if (responses.some((response) => !response.ok)) {
    throw new Error("Could not load the showcase");
  }

  const [config, triggers, events] = await Promise.all(
    responses.map((response) => response.json()),
  );
  byId("webhook-url").textContent = config.webhookUrl;

  const select = byId("trigger");
  select.innerHTML = "";
  for (const trigger of triggers.items || []) {
    const option = document.createElement("option");
    option.value = trigger.id;
    option.textContent = trigger.name;
    select.appendChild(option);
  }
  if (!select.options.length) {
    const option = document.createElement("option");
    option.textContent = "No custom triggers found";
    select.appendChild(option);
    byId("start").disabled = true;
  }

  state.events = events.items || [];
  render();
}

async function startWorkflow() {
  let payload;
  try {
    payload = JSON.parse(byId("payload").value);
  } catch {
    toast("Payload is not valid JSON");
    return;
  }

  const button = byId("start");
  button.disabled = true;
  button.firstElementChild.textContent = "STARTING…";
  try {
    const response = await fetch("/api/workflows/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        triggerId: byId("trigger").value,
        payload,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message);
    toast(`Workflow queued · ${body.enqueued_count ?? body.enqueuedCount ?? "✓"}`);
  } catch (error) {
    toast(error.message || "Could not start workflow");
  } finally {
    button.disabled = false;
    button.firstElementChild.textContent = "START WORKFLOW";
  }
}

function connectEventStream() {
  const stream = new EventSource("/api/events/stream");
  stream.onopen = () => {
    byId("connection").textContent = "LIVE / SECURE";
  };
  stream.onerror = () => {
    byId("connection").textContent = "RECONNECTING";
  };
  stream.addEventListener("webhook", (message) => {
    const event = JSON.parse(message.data);
    state.events = [
      event,
      ...state.events.filter((item) => item.sequence !== event.sequence),
    ].slice(0, 100);
    render();
    if (event.downloadUrl) toast("File received and downloaded");
  });
}

function showSetupError(error) {
  const message = error.message || "Setup failed";
  byId("connection").textContent = "ACCESS REQUIRED";
  byId("events").innerHTML = `<div class="empty"><div>
    <strong>${escapeHtml(message)}</strong><br>
    <small>Use the secure URL printed by showcase.py.</small>
  </div></div>`;
  toast(message);
}

byId("start").addEventListener("click", startWorkflow);
load().then(connectEventStream).catch(showSetupError);
