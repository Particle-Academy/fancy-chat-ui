import type { AnswerDraft, ChatEvent, Part } from "@particle-academy/fancy-chat-js";

export type TransportMode = "sse" | "poll";
export type ConnectionState = "connecting" | "live" | "polling" | "retrying" | "closed";

export interface SubscribeHandlers {
  /** The last seq the client has applied; every (re)connect resumes after it. */
  after: () => number;
  onEvents: (events: ChatEvent[]) => void;
  onMode?: (mode: TransportMode) => void;
  onConnection?: (state: ConnectionState) => void;
  onError?: (error: unknown) => void;
}

export interface SendInput {
  parts: Part[];
  /** Edit-and-resend: the message this one replaces. The host decides fork or truncate. */
  supersedes?: string;
  /** A client id the server echoes, so the composer can match the outcome. */
  clientMessageId?: string;
}

export interface SendResult {
  messageId: string;
  seq: number;
  delivery: string;
  /**
   * Set when the server took the text as a typed approval (opt-in per app): it
   * was recorded as the decision and never delivered to the agent.
   */
  typedDecision?: { approvalId: string; optionId: string; decision: string; state: string };
}

export type CancelOutcome = "ok" | "not-running" | "no-turn" | "unsupported" | "refused" | "uncertain";

/**
 * How a chat surface talks to its server. The HTTP transport below speaks the
 * fancy-chat-php / fancy-chat-js routes; a host with another backend supplies
 * its own. Decisions carry NO actor: the server takes the actor from its own
 * authenticated resolver, never from the request body.
 */
export interface ChatTransport {
  subscribe(handlers: SubscribeHandlers): () => void;
  /** One-shot replay after a seq: gap repair and nudges. */
  fetchAfter(after: number): Promise<{ events: ChatEvent[]; next: number }>;
  send(input: SendInput): Promise<SendResult>;
  cancel(mode: "stop" | "interrupt"): Promise<{ outcome: CancelOutcome }>;
  unsend(messageId: string): Promise<{ ok: boolean }>;
  decide(approvalId: string, input: { optionId: string; note?: string; edited?: unknown }): Promise<unknown>;
  answer(questionId: string, input: AnswerDraft): Promise<unknown>;
  /** Revert an undoable action inside its window. The server refuses a late or non-human revert. */
  revertUndo(actionId: string): Promise<unknown>;
}

export interface HttpTransportOptions {
  /** Where the host mounted the routes, e.g. "/fancy-chat". No trailing slash. */
  baseUrl: string;
  threadId: string;
  fetch?: typeof fetch;
  EventSource?: typeof EventSource;
  /** `auto` tries SSE and falls back to long-poll. Default `auto`. */
  mode?: "auto" | TransportMode;
  /** Consecutive SSE failures, before any event arrived, that switch to long-poll. Default 2. */
  sseFailuresBeforePoll?: number;
  /** Long-poll hold in milliseconds, sent as `wait` (fancy-chat-php reads milliseconds). Default 25000. */
  pollWaitMs?: number;
  /** Minimum gap after an EMPTY poll response, so an early answer cannot spin the loop. Default 250. */
  minPollGapMs?: number;
  /** Delay before a reconnect or a retried poll. Default 1000. */
  retryMs?: number;
  /** Extra request headers (a CSRF token, say), read per request. */
  headers?: () => Record<string, string>;
  /** Fetch credentials. Default `same-origin`. */
  credentials?: RequestCredentials;
  withCredentials?: boolean;
  /**
   * The surface profile this transport serves. Sent as `X-Fancy-Chat-Profile`
   * (and `profile=` on the event streams, which cannot carry headers); any
   * filtering by it is the host's policy on the server.
   */
  profileId?: string;
}

function parseEvents(data: string): ChatEvent[] {
  const parsed = JSON.parse(data) as unknown;
  if (Array.isArray(parsed)) return parsed as ChatEvent[];
  return [parsed as ChatEvent];
}

/**
 * Drop trailing slashes with a scan from the end. Not a regex: `/\/+$/` retries
 * from every slash in a run that is not at the end, which is quadratic
 * (code scanning #1).
 */
function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end -= 1;
  return url.slice(0, end);
}

export function createHttpTransport(options: HttpTransportOptions): ChatTransport {
  const base = trimTrailingSlashes(options.baseUrl);
  const thread = `${base}/threads/${encodeURIComponent(options.threadId)}`;
  const profileQuery = options.profileId ? `&profile=${encodeURIComponent(options.profileId)}` : "";
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const ES = options.EventSource ?? (globalThis as { EventSource?: typeof EventSource }).EventSource;
  const retryMs = options.retryMs ?? 1000;
  const pollWaitMs = options.pollWaitMs ?? 25000;
  const failuresBeforePoll = options.sseFailuresBeforePoll ?? 2;
  const minPollGapMs = options.minPollGapMs ?? 250;

  const request = async (method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<unknown> => {
    const res = await doFetch(url, {
      method,
      credentials: options.credentials ?? "same-origin",
      headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(options.profileId ? { "X-Fancy-Chat-Profile": options.profileId } : {}), ...(options.headers?.() ?? {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : {};
    if (!res.ok) {
      const reason = (json as { error?: string }).error ?? `HTTP ${res.status}`;
      throw Object.assign(new Error(reason), { status: res.status, body: json });
    }
    return json;
  };

  const poll = (after: number, waitMs: number, signal?: AbortSignal) =>
    request("GET", `${thread}/events/poll?after=${after}&wait=${Math.round(waitMs)}${profileQuery}`, undefined, signal) as Promise<{ events: ChatEvent[]; next: number }>;

  return {
    subscribe(h) {
      let stopped = false;
      let es: EventSource | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let failures = 0;
      let delivered = false;
      let mode: TransportMode = options.mode === "poll" || !ES ? "poll" : "sse";
      const abort = new AbortController();

      const later = (fn: () => void) => {
        timer = setTimeout(() => {
          timer = null;
          if (!stopped) fn();
        }, retryMs);
      };

      const runPoll = async () => {
        h.onConnection?.("polling");
        while (!stopped) {
          try {
            const r = await poll(h.after(), pollWaitMs, abort.signal);
            if (stopped) return;
            if (r.events?.length) h.onEvents(r.events);
            // A server that answers an empty poll early (or a proxy that cuts
            // the hold) must not turn this loop into a busy spin.
            else await new Promise((res) => setTimeout(res, minPollGapMs));
          } catch (error) {
            if (stopped) return;
            h.onError?.(error);
            h.onConnection?.("retrying");
            await new Promise((r) => setTimeout(r, retryMs));
            h.onConnection?.("polling");
          }
        }
      };

      const openSse = () => {
        if (!ES) return;
        h.onConnection?.("connecting");
        es = new ES(`${thread}/events?after=${h.after()}${profileQuery}`, { withCredentials: options.withCredentials ?? false });
        es.onopen = () => h.onConnection?.("live");
        es.onmessage = (e: MessageEvent) => {
          delivered = true;
          failures = 0;
          try {
            h.onEvents(parseEvents(String(e.data)));
          } catch (error) {
            h.onError?.(error);
          }
        };
        es.onerror = () => {
          es?.close();
          es = null;
          if (stopped) return;
          failures += 1;
          // A CDN that buffers or kills SSE (Cloudflare HTTP/3, the reason
          // fancy-cf-relay exists) shows up as failures before any event. Once
          // SSE has delivered, a drop is a drop: reconnect from the cursor.
          if (options.mode !== "sse" && !delivered && failures >= failuresBeforePoll) {
            mode = "poll";
            h.onMode?.("poll");
            void runPoll();
            return;
          }
          h.onConnection?.("retrying");
          later(openSse);
        };
      };

      h.onMode?.(mode);
      if (mode === "sse") openSse();
      else void runPoll();

      return () => {
        stopped = true;
        abort.abort();
        if (timer) clearTimeout(timer);
        es?.close();
        h.onConnection?.("closed");
      };
    },
    fetchAfter: (after) => poll(after, 0),
    send: (input) => request("POST", `${thread}/messages`, input) as Promise<SendResult>,
    cancel: (mode) => request("POST", `${thread}/cancel`, { mode }) as Promise<{ outcome: CancelOutcome }>,
    unsend: (messageId) => request("DELETE", `${thread}/queue/${encodeURIComponent(messageId)}`) as Promise<{ ok: boolean }>,
    decide: (approvalId, input) => request("POST", `${base}/approvals/${encodeURIComponent(approvalId)}/decision`, input),
    answer: (questionId, input) => request("POST", `${base}/questions/${encodeURIComponent(questionId)}/answer`, input),
    revertUndo: (actionId) => request("POST", `${base}/undo/${encodeURIComponent(actionId)}/revert`, {}),
  };
}
