import {
  applyEvent,
  createSeqLog,
  emptyThreadState,
  ingestEvents,
  rowsOf,
  type ChatEvent,
  type Gap,
  type Row,
  type SeqLog,
  type ThreadState,
} from "@particle-academy/fancy-chat-js";

import type { ChatTransport, ConnectionState, TransportMode } from "./transport";

export interface ThreadSnapshot {
  state: ThreadState;
  rows: Row[];
  lastSeq: number;
  /** Bumped on every change; cheap equality for memoised consumers. */
  version: number;
  connection: ConnectionState;
  mode: TransportMode | null;
  /** A gap being repaired, if any. */
  missing: Gap | null;
  /** Events this client refused (illegal per the contract, or a cancelled turn's tail). Diagnostics. */
  dropped: number;
  error: unknown;
}

export interface ThreadStoreOptions {
  transport: ChatTransport;
  /** Resume from a snapshot the host already has (SSR, cache). */
  initial?: ThreadState;
  /**
   * An OPTIONAL "something new" hint (Laravel Echo / Reverb): call `cb(seq)` when
   * the server says the thread reached `seq`. It only triggers a fetch; a missed
   * nudge costs nothing because SSE or long-poll carries every event anyway.
   */
  nudge?: (cb: (seq: number) => void) => () => void;
}

export interface ThreadStore {
  /** Start, or join a running store. Every start needs its stop; the last stop disconnects. */
  start(): void;
  stop(): void;
  getSnapshot(): ThreadSnapshot;
  subscribe(listener: () => void): () => void;
  /** Apply events from any source (an optimistic echo, a test). Deduped by seq. */
  ingest(events: ChatEvent[]): void;
}

const ABANDONED = new Set(["cancelled", "interrupted"]);
const TURN_EVENTS = new Set(["turn.started", "turn.transition", "turn.settled"]);

export function createThreadStore(options: ThreadStoreOptions): ThreadStore {
  const state: ThreadState = options.initial ? (JSON.parse(JSON.stringify(options.initial)) as ThreadState) : emptyThreadState();
  let log: SeqLog = createSeqLog(state.lastSeq);
  let snapshot: ThreadSnapshot = {
    state,
    rows: rowsOf(state),
    lastSeq: state.lastSeq,
    version: 0,
    connection: "closed",
    mode: null,
    missing: null,
    dropped: 0,
    error: null,
  };
  const listeners = new Set<() => void>();
  let stopSub: (() => void) | null = null;
  let stopNudge: (() => void) | null = null;
  let repairing = false;
  let running = false;
  let users = 0;
  // Quick replies are generated AFTER a turn settles (a separate server job), so
  // interval mode keeps polling for them a while. This is the newest turn that
  // settled `completed` and whose `suggestions.updated` has not arrived, with the
  // time it settled: when this client saw it, or for a settle in the first answer
  // (history from before this page) the event's own time, so an old turn opens
  // no window.
  let suggestionsDue: { turnId: string; since: number } | null = null;
  let answers = 0;

  const publish = (patch: Partial<ThreadSnapshot>, changedRows: boolean) => {
    snapshot = {
      ...snapshot,
      ...patch,
      ...(changedRows ? { rows: rowsOf(state), lastSeq: state.lastSeq } : {}),
      version: snapshot.version + 1,
    };
    for (const l of [...listeners]) l();
  };

  /** A cancelled or interrupted turn's late events are dropped by turnId, never by timing. */
  const abandoned = (event: ChatEvent): boolean => {
    if (TURN_EVENTS.has(event.type)) return false;
    const turnId = event.turnId ?? (typeof event.data?.turnId === "string" ? (event.data.turnId as string) : null);
    if (!turnId) return false;
    const turn = state.turns.find((t) => t.turnId === turnId);
    return !!turn && turn.state === "settled" && turn.outcome !== null && ABANDONED.has(turn.outcome);
  };

  /** A request succeeded: an earlier failure is over, so its error goes. */
  const healthy = () => {
    if (snapshot.error !== null) publish({ error: null }, false);
  };

  // One console warning per store for the first event it refuses, so a server
  // sending malformed or illegal events is visible without flooding the console.
  let warnedRefusal = false;
  const refused = (event: ChatEvent, why: string) => {
    if (warnedRefusal) return;
    warnedRefusal = true;
    console.warn(
      `[fancy-chat] refused an event it could not apply (seq ${event.seq}, ${String(event.type)}: ${why}). It is skipped and counted in snapshot.dropped; later refusals are not logged.`,
    );
  };

  const repair = async (gap: Gap) => {
    if (repairing || !running) return;
    repairing = true;
    try {
      const r = await options.transport.fetchAfter(gap.after);
      repairing = false;
      healthy();
      if (running) ingest(r.events ?? []);
    } catch (error) {
      repairing = false;
      publish({ error }, false);
    }
  };

  const turnIdOf = (event: ChatEvent): string | null =>
    typeof event.data?.turnId === "string" ? (event.data.turnId as string) : (event.turnId ?? null);

  const trackSuggestions = (event: ChatEvent, history: boolean) => {
    const turnId = turnIdOf(event);
    if (event.type === "suggestions.updated") {
      if (suggestionsDue && suggestionsDue.turnId === turnId) suggestionsDue = null;
      return;
    }
    if (event.type !== "turn.settled" || !turnId) return;
    const newest = state.turns.length > 0 ? state.turns[state.turns.length - 1] : undefined;
    if (!newest || newest.turnId !== turnId || newest.state !== "settled" || newest.outcome !== "completed") return;
    const at = Date.parse(event.at);
    suggestionsDue = { turnId, since: history ? (Number.isFinite(at) ? Math.min(at, Date.now()) : Number.NEGATIVE_INFINITY) : Date.now() };
  };

  const dueNow = (): number | null => {
    if (!suggestionsDue) return null;
    const newest = state.turns.length > 0 ? state.turns[state.turns.length - 1] : undefined;
    if (!newest || newest.turnId !== suggestionsDue.turnId || newest.state !== "settled") return null;
    // A snapshot jump may already carry them.
    const projected = (state as ThreadState & { suggestions?: { turnId?: unknown } | null }).suggestions;
    if (projected && projected.turnId === suggestionsDue.turnId) return null;
    return suggestionsDue.since;
  };

  function ingest(events: ChatEvent[], history = false) {
    const r = ingestEvents(log, events);
    log = r.log;
    let dropped = 0;
    for (const event of r.applied) {
      if (abandoned(event)) {
        state.lastSeq = event.seq;
        dropped += 1;
        continue;
      }
      const before = state.illegal;
      try {
        applyEvent(state, event);
      } catch (error) {
        // fancy-chat-js 0.1.0, inside the peer range, can throw on a malformed
        // event. A throw here would reach the transport as a failed request, and
        // it would retry the same batch forever. Skip it and move past it.
        state.illegal += 1;
        state.lastSeq = event.seq;
        refused(event, error instanceof Error ? error.message : String(error));
      }
      const illegal = state.illegal - before;
      if (illegal > 0) refused(event, "illegal under the contract");
      else trackSuggestions(event, history);
      dropped += illegal;
    }
    const changed = r.applied.length > 0;
    const missingChanged = (r.missing?.after ?? null) !== (snapshot.missing?.after ?? null) || (r.missing?.before ?? null) !== (snapshot.missing?.before ?? null);
    if (changed || missingChanged) publish({ missing: r.missing, dropped: snapshot.dropped + dropped }, changed);
    if (r.missing) void repair(r.missing);
  }

  return {
    start() {
      users += 1;
      if (running) return;
      running = true;
      answers = 0;
      stopSub = options.transport.subscribe({
        after: () => log.lastSeq,
        // The first answer after start is the thread's history: its settles are dated
        // by their own `at`, not by when this page happened to load them.
        onEvents: (events) => ingest(events, answers <= 1),
        onMode: (mode) => publish({ mode }, false),
        onConnection: (connection) => publish({ connection }, false),
        onError: (error) => publish({ error }, false),
        onHealthy: () => {
          answers += 1;
          healthy();
        },
        suggestionsDue: dueNow,
        // A turn in flight: what interval mode polls for. A parked turn waits on a
        // human, whose action wakes the transport, so it does not count.
        active: () => state.turns.some((t) => t.state === "pending" || t.state === "running" || t.state === "cancelling"),
      });
      stopNudge =
        options.nudge?.((seq) => {
          if (seq > log.lastSeq && running) void repair({ after: log.lastSeq, before: seq });
        }) ?? null;
    },
    stop() {
      users = Math.max(0, users - 1);
      if (users > 0) return;
      running = false;
      stopSub?.();
      stopNudge?.();
      stopSub = null;
      stopNudge = null;
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ingest,
  };
}
