import {
  ask,
  askStream,
  abortSession,
  createSession,
  replyToPermission,
  replyToQuestion,
  OpenCodeError,
  type PermissionRequest,
  type QuestionRequest,
} from "./client.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const baseUrlEl = $<HTMLInputElement>("base-url");
const newSessionBtn = $<HTMLButtonElement>("new-session");
const sessionEl = $<HTMLElement>("session-id");
const messagesEl = $<HTMLElement>("messages");
const form = $<HTMLFormElement>("composer");
const inputEl = $<HTMLInputElement>("input");
const sendBtn = $<HTMLButtonElement>("send");
const streamEl = $<HTMLInputElement>("stream-toggle");
const statusEl = $<HTMLElement>("status");
const stopBtn = $<HTMLButtonElement>("stop");

let sessionId: string | null = null;
let busy = false;
let stopCtrl: AbortController | null = null;
let activeSid: string | null = null;

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function addMessage(role: "you" | "assistant", text: string): HTMLElement {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = role === "you" ? "You" : "Assistant";
  const body = document.createElement("div");
  body.className = "body";
  body.textContent = text;
  div.append(who, body);
  messagesEl.append(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return body;
}

function baseUrl(): string {
  return baseUrlEl.value.trim().replace(/\/$/, "") || "http://127.0.0.1:4096";
}

/** Collapsible "agent working" feed; returns its list and a remover. */
function showActivity(): { list: HTMLElement; removeIfEmpty: () => void } {
  const details = document.createElement("details");
  details.className = "activity";
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = "Agent working";
  const list = document.createElement("ul");
  details.append(summary, list);
  messagesEl.append(details);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return {
    list,
    removeIfEmpty: () => {
      if (!list.children.length) details.remove();
    },
  };
}

function addActivity(list: HTMLElement, text: string, kind: string): void {
  const li = document.createElement("li");
  li.className = `act-${kind}`;
  li.textContent = text;
  list.append(li);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/** Interactive card for an agent question; answers resume the stalled run. */
function showQuestion(req: QuestionRequest, activityList: HTMLElement): void {
  addActivity(activityList, "Waiting for your answer…", "question");
  setStatus("Agent is waiting for your answer.");
  const div = document.createElement("div");
  div.className = "question-card";
  req.questions.forEach((q, qi) => {
    const field = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = q.header || `Question ${qi + 1}`;
    const text = document.createElement("p");
    text.className = "qtext";
    text.textContent = q.question;
    field.append(legend, text);
    q.options.forEach((opt) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = q.multiple ? "checkbox" : "radio";
      input.name = `q-${req.id}-${qi}`;
      input.value = opt.label;
      label.append(input, document.createTextNode(opt.label + (opt.description ? ` — ${opt.description}` : "")));
      field.append(label);
    });
    div.append(field);
  });
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Send answers";
  btn.addEventListener("click", async () => {
    const answers = req.questions.map((_, qi) =>
      [...div.querySelectorAll<HTMLInputElement>(`input[name="q-${CSS.escape(req.id)}-${qi}"]:checked`)].map(
        (i) => i.value,
      ),
    );
    if (answers.some((a) => a.length === 0)) {
      setStatus("Pick an answer for every question.", true);
      return;
    }
    btn.disabled = true;
    try {
      await replyToQuestion(baseUrl(), req.id, answers);
      div.classList.add("answered");
      setStatus("Answers sent — working…");
    } catch (e) {
      btn.disabled = false;
      setStatus(messageOf(e), true);
    }
  });
  div.append(btn);
  messagesEl.append(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/** Approval card for a tool permission request. */
function showPermission(req: PermissionRequest, activityList: HTMLElement): void {
  addActivity(activityList, `Waiting for approval: ${req.permission}`, "question");
  setStatus("Agent is waiting for tool approval.");
  const div = document.createElement("div");
  div.className = "question-card";
  const text = document.createElement("p");
  text.className = "qtext";
  text.textContent = `Allow "${req.permission}"${req.patterns.length ? ` (${req.patterns.join(", ")})` : ""}?`;
  div.append(text);
  const row = document.createElement("div");
  row.className = "btn-row";
  (["once", "always", "reject"] as const).forEach((reply) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = reply === "once" ? "Allow once" : reply === "always" ? "Always allow" : "Reject";
    btn.addEventListener("click", async () => {
      row.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        await replyToPermission(baseUrl(), req.id, reply);
        div.classList.add("answered");
        setStatus(reply === "reject" ? "Rejected — working…" : "Approved — working…");
      } catch (e) {
        row.querySelectorAll("button").forEach((b) => (b.disabled = false));
        setStatus(messageOf(e), true);
      }
    });
    row.append(btn);
  });
  div.append(row);
  messagesEl.append(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
/** Animated "agent is thinking" bubble with an elapsed-time label. */
function showThinking(): { element: HTMLElement; remove: () => void } {
  const div = document.createElement("div");
  div.className = "msg assistant thinking";
  div.setAttribute("role", "status");
  const dots = document.createElement("span");
  dots.className = "dots";
  dots.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "Thinking…";
  div.append(dots, label);
  messagesEl.append(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  const started = Date.now();
  const timer = setInterval(() => {
    label.textContent = `Thinking… ${((Date.now() - started) / 1000).toFixed(0)}s`;
  }, 500);
  return {
    element: div,
    remove: () => {
      clearInterval(timer);
      div.remove();
    },
  };
}

async function ensureSession(): Promise<string> {
  if (sessionId) return sessionId;
  setStatus("Creating session…");
  sessionId = await createSession(baseUrl());
  sessionEl.textContent = sessionId;
  setStatus("Session ready.");
  return sessionId;
}

newSessionBtn.addEventListener("click", async () => {
  try {
    setStatus("Creating session…");
    sessionId = await createSession(baseUrl(), "web-chat");
    sessionEl.textContent = sessionId;
    messagesEl.innerHTML = "";
    setStatus("New session ready.");
    inputEl.focus();
  } catch (e) {
    setStatus(`Failed to create session: ${messageOf(e)}`, true);
  }
});

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const question = inputEl.value.trim();
  if (!question || busy) return;
  busy = true;
  sendBtn.disabled = true;
  stopBtn.hidden = false;
  stopCtrl = new AbortController();
  inputEl.value = "";
  addMessage("you", question);
  const thinking = showThinking();
  let settled = false;
  const settle = () => {
    if (!settled) {
      settled = true;
      thinking.remove();
    }
  };
  try {
    const sid = await ensureSession();
    activeSid = sid;
    if (streamEl.checked) {
      setStatus("Streaming…");
      const activity = showActivity();
      let body: HTMLElement | null = null;
      for await (const delta of askStream(baseUrl(), sid, question, {
        signal: stopCtrl.signal,
        onActivity: (a) => addActivity(activity.list, a.text, a.kind),
        onQuestion: (q) => showQuestion(q, activity.list),
        onPermission: (p) => showPermission(p, activity.list),
      })) {
        if (!body) {
          settle(); // first delta replaces the thinking bubble
          body = addMessage("assistant", "");
        }
        body.textContent += delta;
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
      settle();
      if (!body) addMessage("assistant", stopCtrl.signal.aborted ? "(stopped)" : "(no text response)");
      activity.removeIfEmpty();
      setStatus(stopCtrl.signal.aborted ? "Stopped." : "Done.");
    } else {
      setStatus("Thinking…");
      const resp = await ask(baseUrl(), sid, question);
      settle();
      addMessage("assistant", resp.text);
      setStatus("Done.");
    }
  } catch (e) {
    settle();
    const msg = messageOf(e);
    setStatus(msg, true);
    addMessage("assistant", `Error: ${msg}`);
  } finally {
    busy = false;
    sendBtn.disabled = false;
    stopBtn.hidden = true;
    stopCtrl = null;
    activeSid = null;
    inputEl.focus();
  }
});

stopBtn.addEventListener("click", () => {
  stopCtrl?.abort();
  setStatus("Stopping…");
  if (activeSid) abortSession(baseUrl(), activeSid).catch(() => undefined);
});

function messageOf(e: unknown): string {
  if (e instanceof OpenCodeError) return `${e.message}${e.statusCode ? ` (HTTP ${e.statusCode})` : ""}`;
  return e instanceof Error ? e.message : String(e);
}
