import type { AnswerDraft, ChatEvent, Part } from "@particle-academy/fancy-chat-js";

export type TransportMode = "sse" | "poll" | "interval";
/** `idle` and `paused` are interval mode's: nothing runs, or the tab is hidden. */
export type ConnectionState = "connecting" | "live" | "polling" | "retrying" | "idle" | "paused" | "closed";

export interface SubscribeHandlers {
  /** The last seq the client has applied; every (re)connect resumes after it. */
  after: () => number;
  onEvents: (events: ChatEvent[]) => void;
  onMode?: (mode: TransportMode) => void;
  onConnection?: (state: ConnectionState) => void;
  onError?: (error: unknown) => void;
  /** A request succeeded (a poll answered, the stream opened or delivered): any earlier error is over. */
  onHealthy?: () => void;
  /**
   * Whether the thread has a turn in flight (pending, running or cancelling).
   * Interval mode polls only while this is true, or shortly after an action.
   * The thread store supplies it; without it, interval mode treats the thread
   * as always active.
   */
  active?: () => boolean;
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

/** What the server's backend can do (fancy-chat-php `AgentBackend::capabilities()`). */
export interface BackendCapabilities {
  /** The backend can stop a running turn. When false, offer no Stop. */
  cancel: boolean;
  steering: boolean;
  approvals: boolean;
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
  /**
   * OPTIONAL: re-send a failed, interrupted or cancelled turn's ORIGINAL message as a
   * new turn (fancy-chat-php `POST threads/{id}/turns/{turnId}/retry`; queued behind a
   * running turn like any message). The server finds the input, so it works after a reload.
   */
  retry?(turnId: string): Promise<SendResult>;
  /** OPTIONAL: what the backend can do. Without it, the hook reports `capabilities: null`. */
  capabilities?(): Promise<BackendCapabilities>;
}

export interface HttpTransportOptions {
  /** Where the host mounted the routes, e.g. "/fancy-chat". No trailing slash. */
  baseUrl: string;
  threadId: string;
  fetch?: typeof fetch;
  EventSource?: typeof EventSource;
  /**
   * `auto` tries SSE and falls back to long-poll. Default `auto`.
   * `interval` is for a host that cannot hold a request open (one PHP worker, say):
   * short polls with `wait=0`, only while a turn runs; see `interval`.
   */
  mode?: "auto" | TransportMode;
  /** Interval mode's timing. Every number is milliseconds. */
  interval?: IntervalOptions;
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

export interface IntervalOptions {
  /** Between polls while a turn runs, after one that brought events. Default 1500. */
  activeMs?: number;
  /** Each empty poll while a turn runs multiplies the gap by this. Default 1.5 (1 disables). */
  emptyBackoff?: number;
  /** The empty-answer back-off stops growing here. Default 10000. */
  maxActiveMs?: number;
  /** After an error the gap doubles from activeMs, up to this. Default 30000. */
  maxBackoffMs?: number;
  /**
   * After an action (send, decide, answer, cancel, unsend, revert) it keeps polling
   * this long even before a turn shows up in the log. Default 4000.
   */
  graceMs?: number;
  /** Poll this often while nothing runs. Default null: do not poll while idle. */
  idleMs?: number | null;
  /** Stop polling while the document is hidden; catch up the moment it is shown. Default true. */
  pauseWhenHidden?: boolean;
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

  // Interval mode: every subscription's wake, called after any action.
  const wakers = new Set<() => void>();
  const woken = <T,>(p: Promise<T>): Promise<T> => {
    for (const w of [...wakers]) w();
    return p;
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
      let mode: TransportMode = options.mode === "interval" ? "interval" : options.mode === "poll" || !ES ? "poll" : "sse";
      const abort = new AbortController();

      // A failing poll or stream is never silent: every failure reaches onError,
      // and each failure STREAK warns once on the console, naming the status. A
      // 401 or 419 here usually means the session ended or was regenerated (a
      // login does both); retrying carries on regardless.
      let failing = false;
      const failed = (path: string, error: unknown) => {
        h.onError?.(error);
        if (failing) return;
        failing = true;
        const status = (error as { status?: unknown } | null)?.status;
        const reason = error instanceof Error ? error.message : String(error);
        const hint = status === 401 || status === 419 ? " The session may have ended or been regenerated (a login does both)." : "";
        console.warn(`[fancy-chat] ${path} failed${typeof status === "number" ? ` (HTTP ${status})` : ""}: ${reason}. Retrying.${hint}`);
      };
      const healthy = () => {
        failing = false;
        h.onHealthy?.();
      };
      const pollPath = `${thread}/events/poll`;
      const ssePath = `${thread}/events`;

      const later =(fn: () => void) => {
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
            healthy();
            if (r.events?.length) h.onEvents(r.events);
            // A server that answers an empty poll early (or a proxy that cuts
            // the hold) must not turn this loop into a busy spin.
            else await new Promise((res) => setTimeout(res, minPollGapMs));
          } catch (error) {
            if (stopped) return;
            failed(pollPath, error);
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
        es.onopen = () => {
          healthy();
          h.onConnection?.("live");
        };
        es.onmessage = (e: MessageEvent) => {
          delivered = true;
          failures = 0;
          healthy();
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
          // EventSource hands over no status or reason; say which stream failed.
          failed(ssePath, new Error(`The event stream ${ssePath} failed`));
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

      // ---- interval mode: short polls, only while something runs.
      const iv = options.interval ?? {};
      const activeMs = iv.activeMs ?? 1500;
      const emptyBackoff = iv.emptyBackoff ?? 1.5;
      const maxActiveMs = iv.maxActiveMs ?? 10000;
      const maxBackoffMs = iv.maxBackoffMs ?? 30000;
      const graceMs = iv.graceMs ?? 4000;
      const idleMs = iv.idleMs ?? null;
      const pauseWhenHidden = iv.pauseWhenHidden ?? true;
      const doc = (globalThis as { document?: Document }).document;
      const isHidden = () => pauseWhenHidden && doc?.visibilityState === "hidden";
      let gap = activeMs;
      let errors = 0;
      let wokeAt = Number.NEGATIVE_INFINITY;
      let inFlight = false;
      let paused = false;
      let again = false;

      const schedule = (ms: number) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          void tick();
        }, ms);
      };
      const tick = async (): Promise<void> => {
        if (stopped) return;
        if (isHidden()) {
          paused = true;
          h.onConnection?.("paused");
          return;
        }
        if (inFlight) {
          again = true;
          return;
        }
        inFlight = true;
        h.onConnection?.("polling");
        let delay: number | null;
        try {
          const r = await poll(h.after(), 0, abort.signal);
          if (stopped) return;
          errors = 0;
          healthy();
          if (r.events?.length) {
            h.onEvents(r.events);
            gap = activeMs;
          } else {
            gap = Math.min(maxActiveMs, gap * emptyBackoff);
          }
          const running = h.active ? h.active() : true;
          const graceLeft = Date.now() + gap - wokeAt <= graceMs;
          delay = running || graceLeft ? gap : idleMs;
        } catch (error) {
          if (stopped) return;
          failed(pollPath, error);
          errors += 1;
          delay = Math.min(maxBackoffMs, activeMs * 2 ** errors);
          h.onConnection?.("retrying");
        } finally {
          inFlight = false;
        }
        if (stopped) return;
        if (again) {
          again = false;
          schedule(0);
        } else if (delay !== null) {
          if (errors === 0) h.onConnection?.(h.active && !h.active() && delay === idleMs ? "idle" : "polling");
          schedule(delay);
        } else {
          h.onConnection?.("idle");
        }
      };
      const wake = () => {
        if (stopped) return;
        wokeAt = Date.now();
        gap = activeMs;
        schedule(0);
      };
      const onVisibility = () => {
        if (stopped || isHidden() || !paused) return;
        paused = false;
        schedule(0);
      };

      h.onMode?.(mode);
      if (mode === "interval") {
        wakers.add(wake);
        doc?.addEventListener("visibilitychange", onVisibility);
        schedule(0);
      } else if (mode === "sse") openSse();
      else void runPoll();

      return () => {
        stopped = true;
        abort.abort();
        if (timer) clearTimeout(timer);
        wakers.delete(wake);
        doc?.removeEventListener("visibilitychange", onVisibility);
        es?.close();
        h.onConnection?.("closed");
      };
    },
    fetchAfter: (after) => poll(after, 0),
    // Each action wakes interval mode once it has landed: it may start or resume a turn.
    send: (input) => request("POST", `${thread}/messages`, input).then((r) => woken(Promise.resolve(r as SendResult))),
    cancel: (mode) => request("POST", `${thread}/cancel`, { mode }).then((r) => woken(Promise.resolve(r as { outcome: CancelOutcome }))),
    unsend: (messageId) => request("DELETE", `${thread}/queue/${encodeURIComponent(messageId)}`).then((r) => woken(Promise.resolve(r as { ok: boolean }))),
    decide: (approvalId, input) => request("POST", `${base}/approvals/${encodeURIComponent(approvalId)}/decision`, input).then((r) => woken(Promise.resolve(r))),
    answer: (questionId, input) => request("POST", `${base}/questions/${encodeURIComponent(questionId)}/answer`, input).then((r) => woken(Promise.resolve(r))),
    revertUndo: (actionId) => request("POST", `${base}/undo/${encodeURIComponent(actionId)}/revert`, {}).then((r) => woken(Promise.resolve(r))),
    retry: (turnId) => request("POST", `${thread}/turns/${encodeURIComponent(turnId)}/retry`, {}).then((r) => woken(Promise.resolve(r as SendResult))),
    capabilities: () => request("GET", `${thread}/capabilities`).then((r) => (r as { capabilities: BackendCapabilities }).capabilities),
  };
}
