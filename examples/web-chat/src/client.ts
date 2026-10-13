/**
 * Minimal typed client for an OpenCode server — mirrors the Python
 * `opencode-py-client` package. No dependencies; works in browsers and Node 18+.
 *
 * Verified routes (opencode 1.0.0, server `/doc`):
 * - POST {base}/session -> Session JSON (`createSession`)
 * - POST {base}/session/{id}/message {parts:[{type:"text",text}]} blocks and
 *   returns {info, parts} JSON (`ask`)
 * - POST {base}/session/{id}/prompt_async (204) + GET {base}/event SSE stream
 *   of `message.part.delta` events, ends on `session.idle` (`askStream`)
 */

export interface AskOptions {
  agent?: string;
  /** "providerID/modelID" string or { providerID, modelID } / { providerID, id }. */
  model?: string | { providerID: string; modelID?: string; id?: string };
  variant?: string;
  system?: string;
  /**
   * Stream-only: called once per agent-working milestone parsed from
   * `message.part.updated` events (steps, tool running/finished, reasoning).
   * Never sent to the server; safe to pass alongside agent/model options.
   */
  onActivity?: (event: ActivityEvent) => void;
  /** Called when the agent waits for user answers (`question.asked`). */
  onQuestion?: (request: QuestionRequest) => void;
  /** Called when the agent waits for tool approval (`permission.asked`). */
  onPermission?: (request: PermissionRequest) => void;
  /** Abort the stream (e.g. a Stop button). Execution timeout still applies. */
  signal?: AbortSignal;
}

/** One agent-working milestone (stream mode only, via `onActivity`). */
export interface ActivityEvent {
  kind: "step" | "tool" | "reasoning" | "text";
  text: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface AgentQuestion {
  header: string;
  question: string;
  options: QuestionOption[];
  multiple: boolean;
}

/** Agent waiting for user answers — reply with `replyToQuestion`. */
export interface QuestionRequest {
  id: string;
  sessionID: string;
  questions: AgentQuestion[];
}

/** Agent waiting for tool approval — reply with `replyToPermission`. */
export interface PermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
}

export interface AskResponse {
  text: string;
  sessionId: string;
  messageId: string | null;
  agent: string | null;
  modelId: string | null;
  providerId: string | null;
  finish: string | null;
  raw: unknown;
}

export class OpenCodeError extends Error {
  statusCode: number | null;
  detail: unknown;
  constructor(message: string, statusCode: number | null = null, detail: unknown = null) {
    super(message);
    this.name = "OpenCodeError";
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

function splitModel(model: AskOptions["model"]): { providerID?: string; modelID?: string } {
  if (!model) return {};
  if (typeof model === "object") {
    return { providerID: model.providerID, modelID: model.modelID ?? model.id };
  }
  for (const sep of ["/", ":"]) {
    if (model.includes(sep)) {
      const i = model.indexOf(sep);
      return { providerID: model.slice(0, i) || undefined, modelID: model.slice(i + 1) || undefined };
    }
  }
  return { modelID: model };
}

function activityForPart(part: {
  id?: string;
  type?: string;
  tool?: string;
  reason?: string;
  state?: { status?: string };
}): ActivityEvent | null {
  switch (part.type) {
    case "step-start":
      return { kind: "step", text: "Step started" };
    case "step-finish":
      return { kind: "step", text: `Step finished${part.reason ? ` (${part.reason})` : ""}` };
    case "tool": {
      const name = part.tool ?? "tool";
      const status = part.state?.status;
      if (status === "running") return { kind: "tool", text: `Running ${name}…` };
      if (status === "completed") return { kind: "tool", text: `${name} finished` };
      if (status === "error") return { kind: "tool", text: `${name} failed` };
      return null; // pending is noise; running/completed follow
    }
    case "reasoning":
      return { kind: "reasoning", text: "Reasoning…" };
    case "text":
      return { kind: "text", text: "Writing response…" };
    default:
      return null;
  }
}

async function throwForStatus(res: Response): Promise<void> {
  if (res.status < 400) return;
  let detail: unknown;
  try {
    detail = await res.json();
  } catch {
    detail = await res.text().catch(() => null);
  }
  const msg = `OpenCode server returned ${res.status}: ${JSON.stringify(detail)?.slice(0, 500)}`;
  throw new OpenCodeError(msg, res.status, detail);
}

/** Create a session; resolve with its native session ID (`ses_...`). */
export async function createSession(baseUrl: string, title?: string, options?: AskOptions): Promise<string> {
  const body: Record<string, unknown> = {};
  if (title !== undefined) body.title = title;
  if (options?.agent) body.agent = options.agent;
  const { providerID, modelID } = splitModel(options?.model);
  if (providerID && modelID) body.model = { id: modelID, providerID };
  const res = await fetch(`${baseUrl}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await throwForStatus(res);
  const data = (await res.json()) as { id: string };
  if (!data?.id) throw new OpenCodeError(`unexpected session response`, null, data);
  return data.id;
}

/** Answer an agent question; `answers[i]` holds the selected labels for question i. */
export async function replyToQuestion(baseUrl: string, requestId: string, answers: string[][]): Promise<void> {
  const res = await fetch(`${baseUrl}/question/${requestId}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  await throwForStatus(res);
}

/** Approve (`once`/`always`) or deny (`reject`) a tool permission request. */
export async function replyToPermission(
  baseUrl: string,
  requestId: string,
  reply: "once" | "always" | "reject",
): Promise<void> {
  const res = await fetch(`${baseUrl}/permission/${requestId}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply }),
  });
  await throwForStatus(res);
}

/** Stop any ongoing AI processing for a session. The stream then ends without `session.idle`. */
export async function abortSession(baseUrl: string, sessionId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/session/${sessionId}/abort`, { method: "POST" });
  await throwForStatus(res);
}

/** Submit a question and wait for the completed response. */
export async function ask(
  baseUrl: string,
  sessionId: string,
  question: string,
  options?: AskOptions,
  timeoutMs = 300_000,
): Promise<AskResponse> {
  if (!sessionId) throw new OpenCodeError("sessionId is required", 400);
  const body: Record<string, unknown> = { parts: [{ type: "text", text: question }] };
  if (options?.agent) body.agent = options.agent;
  const { providerID, modelID } = splitModel(options?.model);
  if (providerID && modelID) body.model = { providerID, modelID };
  if (options?.variant) body.variant = options.variant;
  if (options?.system) body.system = options.system;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("ask timed out")), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/session/${sessionId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    await throwForStatus(res);
    const data = (await res.json()) as {
      info: Record<string, unknown> & { error?: unknown };
      parts: Array<{ type: string; text?: string }>;
    };
    if (data?.info?.error) {
      throw new OpenCodeError(`assistant message carries error`, null, data.info.error);
    }
    const text = (data.parts ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
    const info = (data.info ?? {}) as Record<string, string>;
    return {
      text,
      sessionId: info.sessionID ?? sessionId,
      messageId: info.id ?? null,
      agent: info.agent ?? null,
      modelId: info.modelID ?? null,
      providerId: info.providerID ?? null,
      finish: info.finish ?? null,
      raw: data,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Yield incremental text deltas as they arrive.
 * Subscribe-then-send order is required: the SSE subscription opens first,
 * then `prompt_async` fires, so no early delta is missed.
 */
export async function* askStream(
  baseUrl: string,
  sessionId: string,
  question: string,
  options?: AskOptions,
  timeoutMs = 300_000,
): AsyncGenerator<string, void, void> {
  if (!sessionId) throw new OpenCodeError("sessionId is required", 400);
  const body: Record<string, unknown> = { parts: [{ type: "text", text: question }] };
  if (options?.agent) body.agent = options.agent;
  const { providerID, modelID } = splitModel(options?.model);
  if (providerID && modelID) body.model = { providerID, modelID };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("stream timed out")), timeoutMs);
  let userAborted = false;
  const onUserAbort = () => {
    userAborted = true;
    ctrl.abort(new Error("stopped by user"));
  };
  options?.signal?.addEventListener("abort", onUserAbort);
  try {
    // 1. Subscribe first.
    const stream = await fetch(`${baseUrl}/event`, {
      headers: { Accept: "text/event-stream" },
      signal: ctrl.signal,
    });
    await throwForStatus(stream);
    if (!stream.body) throw new OpenCodeError("SSE stream has no body");

    // 2. Fire the prompt only once the subscription is live.
    const fire = await fetch(`${baseUrl}/session/${sessionId}/prompt_async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    await throwForStatus(fire);

    // 3. Consume SSE: "data: {...}" lines, filter by session, yield deltas.
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    const onActivity = options?.onActivity;
    const announced = new Set<string>(); // one activity line per part-phase
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trimEnd();
        buf = buf.slice(nl + 1);
        if (!line || line.startsWith(":") || !line.startsWith("data:")) continue;
        let event: { type?: string; properties?: Record<string, unknown> };
        try {
          event = JSON.parse(line.slice(5).trim());
        } catch {
          continue; // skip malformed line
        }
        const props = (event.properties ?? {}) as Record<string, unknown>;
        if (props.sessionID !== sessionId) continue;
        if (event.type === "session.error") {
          throw new OpenCodeError(`session error`, null, props.error ?? event);
        }
        if (event.type === "message.part.delta" && (props.field ?? "text") === "text") {
          const delta = props.delta as string;
          if (delta) yield delta;
        } else if (event.type === "message.part.updated" && onActivity) {
          const part = props.part as { id?: string; type?: string } | undefined;
          if (part && typeof part.type === "string") {
            const phase =
              part.type === "tool"
                ? `tool:${part.id}:${(part as { state?: { status?: string } }).state?.status ?? "?"}`
                : `${part.type}:${part.id}`;
            if (!announced.has(phase)) {
              announced.add(phase);
              const activity = activityForPart(part);
              if (activity) onActivity(activity);
            }
          }
        } else if (event.type === "question.asked" && options?.onQuestion) {
          const p = props as { id?: unknown; questions?: unknown };
          if (typeof p.id === "string" && Array.isArray(p.questions)) {
            options.onQuestion({ id: p.id, sessionID: sessionId, questions: p.questions as AgentQuestion[] });
          }
        } else if (event.type === "permission.asked" && options?.onPermission) {
          const p = props as { id?: unknown; permission?: unknown; patterns?: unknown };
          if (typeof p.id === "string") {
            options.onPermission({
              id: p.id,
              sessionID: sessionId,
              permission: typeof p.permission === "string" ? p.permission : "tool",
              patterns: Array.isArray(p.patterns) ? (p.patterns as string[]) : [],
            });
          }
        } else if (event.type === "session.idle") {
          return;
        } else if (
          event.type === "session.status" &&
          (props.status as { type?: string } | undefined)?.type === "idle"
        ) {
          return;
        }
      }
    }
  } catch (e) {
    if (userAborted) return; // Stop button: end the stream silently
    if (ctrl.signal.aborted) throw new OpenCodeError(`stream for session ${sessionId} timed out`, null, null);
    throw e;
  } finally {
    options?.signal?.removeEventListener("abort", onUserAbort);
    clearTimeout(timer);
    ctrl.abort();
  }
}
