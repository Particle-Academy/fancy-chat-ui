import { emptyThreadState, createSeqLog, rowsOf, partToText, optionTone, canSubmitAnswer, pickActionable, undoWindow, matchTypedApproval, CORE_PART_KINDS, ingestEvents, applyEvent } from '@particle-academy/fancy-chat-js';
import { isValidElement, useState, useRef, useEffect, useMemo, useSyncExternalStore, useCallback } from 'react';
import { Badge, Text, Card, Button, Table, CodeBlock, ContentRenderer, Textarea, RadioGroup, CheckboxGroup, Progress, Timeline, VirtualList, PromptInput, ChatMessage } from '@particle-academy/react-fancy';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';

// src/transport.ts
function parseEvents(data) {
  const parsed = JSON.parse(data);
  if (Array.isArray(parsed)) return parsed;
  return [parsed];
}
function trimTrailingSlashes(url) {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end -= 1;
  return url.slice(0, end);
}
function createHttpTransport(options) {
  const base = trimTrailingSlashes(options.baseUrl);
  const thread = `${base}/threads/${encodeURIComponent(options.threadId)}`;
  const profileQuery = options.profileId ? `&profile=${encodeURIComponent(options.profileId)}` : "";
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const ES = options.EventSource ?? globalThis.EventSource;
  const retryMs = options.retryMs ?? 1e3;
  const pollWaitMs = options.pollWaitMs ?? 25e3;
  const failuresBeforePoll = options.sseFailuresBeforePoll ?? 2;
  const minPollGapMs = options.minPollGapMs ?? 250;
  const request = async (method, url, body, signal) => {
    const res = await doFetch(url, {
      method,
      credentials: options.credentials ?? "same-origin",
      headers: { Accept: "application/json", ...body !== void 0 ? { "Content-Type": "application/json" } : {}, ...options.profileId ? { "X-Fancy-Chat-Profile": options.profileId } : {}, ...options.headers?.() ?? {} },
      ...body !== void 0 ? { body: JSON.stringify(body) } : {},
      ...signal ? { signal } : {}
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const reason = json.error ?? `HTTP ${res.status}`;
      throw Object.assign(new Error(reason), { status: res.status, body: json });
    }
    return json;
  };
  const wakers = /* @__PURE__ */ new Set();
  const woken = (p) => {
    for (const w of [...wakers]) w();
    return p;
  };
  const poll = (after, waitMs, signal) => request("GET", `${thread}/events/poll?after=${after}&wait=${Math.round(waitMs)}${profileQuery}`, void 0, signal);
  return {
    subscribe(h) {
      let stopped = false;
      let es = null;
      let timer = null;
      let failures = 0;
      let delivered = false;
      let mode = options.mode === "interval" ? "interval" : options.mode === "poll" || !ES ? "poll" : "sse";
      const abort = new AbortController();
      let failing = false;
      const failed = (path, error) => {
        h.onError?.(error);
        if (failing) return;
        failing = true;
        const status = error?.status;
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
      const later = (fn) => {
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
        es.onmessage = (e) => {
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
          failed(ssePath, new Error(`The event stream ${ssePath} failed`));
          failures += 1;
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
      const iv = options.interval ?? {};
      const activeMs = iv.activeMs ?? 1500;
      const emptyBackoff = iv.emptyBackoff ?? 1.5;
      const maxActiveMs = iv.maxActiveMs ?? 1e4;
      const maxBackoffMs = iv.maxBackoffMs ?? 3e4;
      const graceMs = iv.graceMs ?? 4e3;
      const idleMs = iv.idleMs ?? null;
      const pauseWhenHidden = iv.pauseWhenHidden ?? true;
      const doc = globalThis.document;
      const isHidden = () => pauseWhenHidden && doc?.visibilityState === "hidden";
      let gap = activeMs;
      let errors = 0;
      let wokeAt = Number.NEGATIVE_INFINITY;
      let inFlight = false;
      let paused = false;
      let again = false;
      const schedule = (ms) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          void tick();
        }, ms);
      };
      const tick = async () => {
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
        let delay;
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
    send: (input) => request("POST", `${thread}/messages`, input).then((r) => woken(Promise.resolve(r))),
    cancel: (mode) => request("POST", `${thread}/cancel`, { mode }).then((r) => woken(Promise.resolve(r))),
    unsend: (messageId) => request("DELETE", `${thread}/queue/${encodeURIComponent(messageId)}`).then((r) => woken(Promise.resolve(r))),
    decide: (approvalId, input) => request("POST", `${base}/approvals/${encodeURIComponent(approvalId)}/decision`, input).then((r) => woken(Promise.resolve(r))),
    answer: (questionId, input) => request("POST", `${base}/questions/${encodeURIComponent(questionId)}/answer`, input).then((r) => woken(Promise.resolve(r))),
    revertUndo: (actionId) => request("POST", `${base}/undo/${encodeURIComponent(actionId)}/revert`, {}).then((r) => woken(Promise.resolve(r))),
    retry: (turnId) => request("POST", `${thread}/turns/${encodeURIComponent(turnId)}/retry`, {}).then((r) => woken(Promise.resolve(r))),
    capabilities: () => request("GET", `${thread}/capabilities`).then((r) => r.capabilities)
  };
}
var ABANDONED = /* @__PURE__ */ new Set(["cancelled", "interrupted"]);
var TURN_EVENTS = /* @__PURE__ */ new Set(["turn.started", "turn.transition", "turn.settled"]);
function createThreadStore(options) {
  const state = options.initial ? JSON.parse(JSON.stringify(options.initial)) : emptyThreadState();
  let log = createSeqLog(state.lastSeq);
  let snapshot = {
    state,
    rows: rowsOf(state),
    lastSeq: state.lastSeq,
    version: 0,
    connection: "closed",
    mode: null,
    missing: null,
    dropped: 0,
    error: null
  };
  const listeners = /* @__PURE__ */ new Set();
  let stopSub = null;
  let stopNudge = null;
  let repairing = false;
  let running = false;
  let users = 0;
  const publish = (patch, changedRows) => {
    snapshot = {
      ...snapshot,
      ...patch,
      ...changedRows ? { rows: rowsOf(state), lastSeq: state.lastSeq } : {},
      version: snapshot.version + 1
    };
    for (const l of [...listeners]) l();
  };
  const abandoned = (event) => {
    if (TURN_EVENTS.has(event.type)) return false;
    const turnId = event.turnId ?? (typeof event.data?.turnId === "string" ? event.data.turnId : null);
    if (!turnId) return false;
    const turn = state.turns.find((t) => t.turnId === turnId);
    return !!turn && turn.state === "settled" && turn.outcome !== null && ABANDONED.has(turn.outcome);
  };
  const healthy = () => {
    if (snapshot.error !== null) publish({ error: null }, false);
  };
  let warnedRefusal = false;
  const refused = (event, why) => {
    if (warnedRefusal) return;
    warnedRefusal = true;
    console.warn(
      `[fancy-chat] refused an event it could not apply (seq ${event.seq}, ${String(event.type)}: ${why}). It is skipped and counted in snapshot.dropped; later refusals are not logged.`
    );
  };
  const repair = async (gap) => {
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
  function ingest(events) {
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
        state.illegal += 1;
        state.lastSeq = event.seq;
        refused(event, error instanceof Error ? error.message : String(error));
      }
      const illegal = state.illegal - before;
      if (illegal > 0) refused(event, "illegal under the contract");
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
      stopSub = options.transport.subscribe({
        after: () => log.lastSeq,
        onEvents: ingest,
        onMode: (mode) => publish({ mode }, false),
        onConnection: (connection) => publish({ connection }, false),
        onError: (error) => publish({ error }, false),
        onHealthy: healthy,
        // A turn in flight: what interval mode polls for. A parked turn waits on a
        // human, whose action wakes the transport, so it does not count.
        active: () => state.turns.some((t) => t.state === "pending" || t.state === "running" || t.state === "cancelling")
      });
      stopNudge = options.nudge?.((seq) => {
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
    ingest
  };
}

// src/labels.ts
var DEFAULT_LABELS = {
  thread: "Conversation",
  loadEarlier: "Load earlier",
  jumpToLatest: (n) => n > 0 ? `Jump to latest (${n} new)` : "Jump to latest",
  thinking: "Thinking",
  thinkingLive: "Thinking...",
  showThinking: "Show thinking",
  hideThinking: "Hide thinking",
  tool: "Tool",
  toolRunning: "Running",
  toolOk: "Done",
  toolFailure: "Failed",
  toolRefusal: "Declined",
  toolArgs: "Arguments",
  toolRetry: "Retry",
  showMore: "Show all",
  showLess: "Show less",
  durationMs: (ms) => ms >= 1e3 ? `${(ms / 1e3).toFixed(1)} s` : `${Math.round(ms)} ms`,
  approval: "Approval needed",
  approvalNote: "Note (optional)",
  approvalDeciding: "Sending your decision...",
  approvalWaiting: "Waiting for an earlier decision",
  approvalStates: {
    pending: "Waiting on you",
    deciding: "Deciding",
    approved: "Approved",
    rejected: "Rejected",
    edited: "Approved with changes",
    applied: "Applied",
    "apply-failed": "Apply failed",
    withdrawn: "Withdrawn",
    expired: "Expired"
  },
  question: "Question",
  questionNote: "Or add a note",
  questionSubmit: "Answer",
  questionLater: "Later",
  questionDismiss: "Dismiss",
  questionAnswered: "Answered",
  questionWaiting: "Waiting for an earlier question",
  unknownPart: "Unsupported content",
  file: "File",
  plan: (n, m) => `Plan ${n}/${m}`,
  delivery: {
    sending: "Sending",
    sent: "Sent",
    queued: "Queued",
    steered: "Sent mid-turn",
    delivered: "Delivered",
    decided: "Taken as your decision",
    failed: "Not sent",
    dropped: "Dropped",
    unsent: "Unsent"
  },
  composerPlaceholder: "Message the agent",
  stop: "Stop",
  sendFailed: (reason) => `Not sent: ${reason}. Your draft is kept.`,
  superseded: "Edited and resent",
  retracted: "Retracted",
  queued: (n) => n === 1 ? "1 queued" : `${n} queued`,
  queueSendAll: "Send all",
  queueDiscard: "Discard all",
  queueSendNow: "Send now",
  queueInterrupt: "Interrupt and send",
  queueUnsend: "Unsend",
  undoOpen: (s) => `Undo available for ${s} s`,
  undoCommitted: "Done",
  undoReverted: "Undone",
  undoRevert: "Undo",
  typedApproval: (d) => d === "reject" ? "Sending this will reject the pending approval." : "Sending this will approve the pending approval.",
  showEarlierVersion: "Show earlier version",
  hideEarlierVersion: "Hide earlier version",
  edit: "Edit",
  heldOnApproval: "Waiting on approval",
  toolOutputTruncated: "Output shortened",
  toolOutputLoading: "Loading the full output...",
  toolOutputError: "The full output could not be loaded.",
  activitySummary: (tools, seconds, failed, exact = true) => `${tools} tool ${tools === 1 ? "call" : "calls"} \xB7 ${exact ? "" : "\u2264 "}${seconds} s${failed > 0 ? ` \xB7 ${failed} failed` : ""}`,
  durationAtMost: (formatted) => `\u2264 ${formatted}`,
  showActivity: "Show steps",
  hideActivity: "Hide steps",
  turnFailed: (reason) => reason ? `The agent stopped: ${reason}` : "The agent stopped with an error.",
  turnRefused: "The agent declined this request.",
  turnRetry: "Retry"
};
function mergeLabels(labels) {
  return labels ? { ...DEFAULT_LABELS, ...labels } : DEFAULT_LABELS;
}
var SAFE_HREF = /^https?:\/\//i;
var SAME_ORIGIN_PATH = /^\/(?![\/\\])/;
function asString(v) {
  return typeof v === "string" ? v : v === void 0 || v === null ? "" : String(v);
}
function HiddenHitl(props) {
  return /* @__PURE__ */ jsx("div", { ...props, hidden: true });
}
function PartView(props) {
  const { part, streaming = false, renderers, registry, resolveRef, onCardAction, contentOptions, renderHitl } = props;
  const labels = mergeLabels(props.labels);
  const renderPart = (child) => /* @__PURE__ */ jsx(PartView, { ...props, part: child, streaming: false });
  const ctx = { streaming, labels, renderPart };
  const handle = { "data-fancy-chat-part": part.id, "data-fancy-chat-part-kind": part.kind };
  const allowed = !props.allowedKinds || props.allowedKinds.includes(part.kind);
  const custom = allowed ? renderers?.[part.kind] : void 0;
  if (custom) return /* @__PURE__ */ jsx("div", { ...handle, children: custom(part, ctx) });
  switch (allowed ? part.kind : "") {
    case "text":
      return /* @__PURE__ */ jsx("div", { ...handle, children: part.format === "plain" ? /* @__PURE__ */ jsx(Text, { className: "whitespace-pre-wrap break-words", children: asString(part.text) }) : /* @__PURE__ */ jsx(ContentRenderer, { ...contentOptions, value: asString(part.text), format: "markdown", streaming }) });
    case "code":
      return /* @__PURE__ */ jsx("div", { ...handle, children: /* @__PURE__ */ jsx(CodeBlock, { code: asString(part.code), title: typeof part.filename === "string" ? part.filename : void 0, language: asString(part.language) }) });
    case "table": {
      const columns = Array.isArray(part.columns) ? part.columns : [];
      const rows = Array.isArray(part.rows) ? part.rows : [];
      return /* @__PURE__ */ jsxs("div", { ...handle, children: [
        /* @__PURE__ */ jsxs(Table, { children: [
          /* @__PURE__ */ jsx(Table.Head, { children: /* @__PURE__ */ jsx(Table.Row, { children: columns.map((c) => /* @__PURE__ */ jsx(Table.Column, { label: c.label }, c.key)) }) }),
          /* @__PURE__ */ jsx(Table.Body, { children: rows.map((row, i) => /* @__PURE__ */ jsx(Table.Row, { children: columns.map((c) => /* @__PURE__ */ jsx(Table.Cell, { children: asString(row[c.key]) }, c.key)) }, i)) })
        ] }),
        typeof part.caption === "string" ? /* @__PURE__ */ jsx(Text, { className: "mt-1 text-xs", children: part.caption }) : null
      ] });
    }
    case "file": {
      const ref = resolveRef?.(part) ?? null;
      const href = ref?.href && SAFE_HREF.test(ref.href) ? ref.href : null;
      return /* @__PURE__ */ jsxs("div", { ...handle, className: "inline-flex items-center gap-2", children: [
        /* @__PURE__ */ jsx(Badge, { color: "zinc", variant: "soft", size: "sm", children: labels.file }),
        href ? /* @__PURE__ */ jsx("a", { href, rel: "noopener noreferrer", target: "_blank", className: "underline", children: asString(part.name) }) : /* @__PURE__ */ jsx("span", { children: asString(part.name) })
      ] });
    }
    case "image": {
      const ref = resolveRef?.(part) ?? null;
      const src = ref?.src && (SAFE_HREF.test(ref.src) || SAME_ORIGIN_PATH.test(ref.src)) ? ref.src : null;
      return /* @__PURE__ */ jsx("div", { ...handle, children: src ? /* @__PURE__ */ jsx("img", { src, alt: asString(part.alt), width: typeof part.width === "number" ? part.width : void 0, height: typeof part.height === "number" ? part.height : void 0, className: "max-w-full rounded" }) : /* @__PURE__ */ jsx(Text, { children: partToText(part, registry) }) });
    }
    case "card": {
      const body = Array.isArray(part.body) ? part.body : [];
      const actions = Array.isArray(part.actions) ? part.actions : [];
      const fields = Array.isArray(part.fields) ? part.fields : [];
      return /* @__PURE__ */ jsx("div", { ...handle, "data-fancy-chat-card-type": asString(part.cardType), children: /* @__PURE__ */ jsxs(Card, { children: [
        typeof part.title === "string" ? /* @__PURE__ */ jsx(Card.Header, { children: part.title }) : null,
        /* @__PURE__ */ jsx(Card.Body, { children: /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-2", children: [
          body.map((child) => /* @__PURE__ */ jsx(PartView, { ...props, part: child, streaming: false }, child.id)),
          fields.length ? /* @__PURE__ */ jsx("dl", { className: "grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm", children: fields.map((f, i) => /* @__PURE__ */ jsxs("div", { className: "contents", children: [
            /* @__PURE__ */ jsx("dt", { className: "font-medium", children: f.label }),
            /* @__PURE__ */ jsx("dd", { children: f.value })
          ] }, i)) }) : null
        ] }) }),
        actions.length ? /* @__PURE__ */ jsx(Card.Footer, { children: /* @__PURE__ */ jsx("div", { className: "flex flex-wrap gap-2", children: actions.map(
          (a) => a.kind === "link" && a.href && SAFE_HREF.test(a.href) ? /* @__PURE__ */ jsx("a", { "data-fancy-chat-card-action": a.id, href: a.href, rel: "noopener noreferrer", target: "_blank", className: "underline", children: a.label }, a.id) : a.kind === "post-back" ? /* @__PURE__ */ jsx(Button, { size: "sm", "data-fancy-chat-card-action": a.id, onClick: () => onCardAction?.(part, a.id), disabled: !onCardAction, children: a.label }, a.id) : null
        ) }) }) : null
      ] }) });
    }
    case "approval":
    case "question": {
      const hitl = renderHitl ? renderHitl(part) : /* @__PURE__ */ jsx(Text, { children: partToText(part, registry) });
      const hidden = isValidElement(hitl) && hitl.type === HiddenHitl;
      return /* @__PURE__ */ jsx("div", { ...handle, hidden: hidden || void 0, children: hitl });
    }
    default:
      return /* @__PURE__ */ jsx("div", { ...handle, "data-fancy-chat-part-unknown": "", children: /* @__PURE__ */ jsx(Badge, { color: "zinc", variant: "outline", size: "sm", title: labels.unknownPart, children: partToText(part, registry) }) });
  }
}
var TONE_COLOR = { positive: "emerald", negative: "red", neutral: "zinc" };
var STATE_COLOR = {
  pending: "amber",
  deciding: "amber",
  approved: "emerald",
  edited: "emerald",
  applied: "emerald",
  rejected: "zinc",
  "apply-failed": "red",
  withdrawn: "zinc",
  expired: "zinc"
};
function ApprovalCard(props) {
  const { record, actionable, onDecide, allowNote = true, typedHint, partViewProps } = props;
  const labels = mergeLabels(props.labels);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const pending = record.state === "pending";
  const options = (record.options ?? []).map((o) => ({ option: o, ...optionTone(o.kind) })).filter((o) => o.tone !== null && o.decision !== null);
  const decide = (option, decision) => {
    if (busyRef.current || !actionable || !pending) return;
    busyRef.current = true;
    setBusy(true);
    const trimmed = note.trim();
    const settle = () => {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    };
    try {
      const result = onDecide({ approvalId: record.approvalId, optionId: option.id, decision, ...trimmed ? { note: trimmed } : {} });
      if (result && typeof result.then === "function") result.then(settle, settle);
      else settle();
    } catch (error) {
      settle();
      throw error;
    }
  };
  return /* @__PURE__ */ jsx(
    "div",
    {
      "data-fancy-chat-approval": record.approvalId,
      "data-fancy-chat-approval-state": record.state,
      "data-fancy-chat-approval-actionable": actionable && pending ? "true" : "false",
      "data-fancy-chat-approval-busy": busy ? "true" : "false",
      "aria-busy": busy || void 0,
      children: /* @__PURE__ */ jsxs(Card, { children: [
        /* @__PURE__ */ jsx(Card.Header, { children: /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
          /* @__PURE__ */ jsx(Badge, { color: STATE_COLOR[record.state] ?? "zinc", variant: "soft", size: "sm", "data-fancy-chat-approval-status": "", children: labels.approvalStates[record.state] ?? record.state }),
          /* @__PURE__ */ jsx("span", { className: "font-medium", children: record.title })
        ] }) }),
        /* @__PURE__ */ jsx(Card.Body, { children: /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-2", children: [
          record.summary ? /* @__PURE__ */ jsx(Text, { children: record.summary }) : null,
          (record.preview ?? []).map((part) => /* @__PURE__ */ jsx(PartView, { ...partViewProps, part }, part.id)),
          pending && allowNote ? /* @__PURE__ */ jsx("div", { "data-fancy-chat-approval-note": "", children: /* @__PURE__ */ jsx(Textarea, { label: labels.approvalNote, value: note, onValueChange: setNote, disabled: !actionable || busy, minRows: 1, autoResize: true }) }) : null,
          pending && typedHint ? /* @__PURE__ */ jsx("div", { "data-fancy-chat-approval-typed-hint": "", children: typedHint }) : null,
          pending && !actionable ? /* @__PURE__ */ jsx(Text, { className: "text-xs", children: labels.approvalWaiting }) : null,
          busy ? /* @__PURE__ */ jsx(Text, { className: "text-xs", "aria-live": "polite", children: labels.approvalDeciding }) : null,
          record.state === "apply-failed" && record.error ? /* @__PURE__ */ jsx(Text, { className: "text-xs text-red-600", children: record.error }) : null
        ] }) }),
        pending ? /* @__PURE__ */ jsx(Card.Footer, { children: /* @__PURE__ */ jsx("div", { className: "flex flex-wrap gap-2", children: options.map(({ option, tone, decision }) => /* @__PURE__ */ jsx(
          Button,
          {
            size: "sm",
            color: TONE_COLOR[tone],
            "data-fancy-chat-option": option.id,
            "data-fancy-chat-option-kind": option.kind,
            "data-fancy-chat-option-tone": tone,
            disabled: !actionable || busy,
            onClick: () => decide(option, decision),
            children: option.label
          },
          option.id
        )) }) }) : null
      ] })
    }
  );
}
function QuestionForm(props) {
  const { question, draft, onDraftChange, onSubmit, actionable, onLater, onDismiss } = props;
  const labels = mergeLabels(props.labels);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const open = (question.state ?? "open") === "open";
  const check = canSubmitAnswer(question, draft);
  const disabled = !actionable || busy;
  const setValue = (id, value) => onDraftChange({ values: { ...draft.values, [id]: value }, notes: { ...draft.notes } });
  const setNote = (id, note) => onDraftChange({ values: { ...draft.values }, notes: { ...draft.notes, [id]: note } });
  const submit = () => {
    if (busyRef.current || disabled || !check.ok || !open) return;
    busyRef.current = true;
    setBusy(true);
    const settle = () => {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    };
    const result = onSubmit({ questionId: question.questionId, values: draft.values, notes: draft.notes });
    if (result && typeof result.then === "function") result.then(settle, settle);
    else settle();
  };
  return /* @__PURE__ */ jsx(
    "div",
    {
      "data-fancy-chat-question": question.questionId,
      "data-fancy-chat-question-state": question.state ?? "open",
      "data-fancy-chat-question-actionable": actionable && open ? "true" : "false",
      "aria-busy": busy || void 0,
      children: /* @__PURE__ */ jsxs(Card, { children: [
        /* @__PURE__ */ jsx(Card.Header, { children: /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
          /* @__PURE__ */ jsx(Badge, { color: open ? "amber" : "emerald", variant: "soft", size: "sm", children: open ? labels.question : labels.questionAnswered }),
          /* @__PURE__ */ jsx("span", { className: "font-medium", children: question.prompt })
        ] }) }),
        open ? /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(Card.Body, { children: /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-3", children: [
            question.fields.map((field) => {
              const value = draft.values[field.id];
              const options = (field.options ?? []).map((o) => ({ value: o.id, label: o.label }));
              return /* @__PURE__ */ jsxs("div", { "data-fancy-chat-field": field.id, "data-fancy-chat-field-type": field.type, className: "flex flex-col gap-1", children: [
                field.type === "single" ? /* @__PURE__ */ jsx(RadioGroup, { label: field.label, required: field.required, list: options, value: typeof value === "string" ? value : void 0, onValueChange: (v) => setValue(field.id, v), disabled, orientation: "vertical" }) : field.type === "multi" ? /* @__PURE__ */ jsx(CheckboxGroup, { label: field.label, required: field.required, list: options, value: Array.isArray(value) ? value : [], onValueChange: (v) => setValue(field.id, v), disabled, orientation: "vertical" }) : /* @__PURE__ */ jsx(Textarea, { label: field.label, required: field.required, value: typeof value === "string" ? value : "", onValueChange: (v) => setValue(field.id, v), disabled, minRows: 1, autoResize: true }),
                question.allowNote && field.type !== "text" ? /* @__PURE__ */ jsx("div", { "data-fancy-chat-field-note": field.id, children: /* @__PURE__ */ jsx(Textarea, { label: labels.questionNote, value: draft.notes[field.id] ?? "", onValueChange: (v) => setNote(field.id, v), disabled, minRows: 1, autoResize: true }) }) : null
              ] }, field.id);
            }),
            !actionable ? /* @__PURE__ */ jsx(Text, { className: "text-xs", children: labels.questionWaiting }) : null
          ] }) }),
          /* @__PURE__ */ jsx(Card.Footer, { children: /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap gap-2", children: [
            /* @__PURE__ */ jsx(Button, { size: "sm", color: "brand", "data-fancy-chat-question-submit": "", disabled: disabled || !check.ok, onClick: submit, children: labels.questionSubmit }),
            onLater ? /* @__PURE__ */ jsx(Button, { size: "sm", variant: "ghost", "data-fancy-chat-question-later": "", onClick: () => onLater(question.questionId), children: labels.questionLater }) : null,
            onDismiss ? /* @__PURE__ */ jsx(Button, { size: "sm", variant: "ghost", "data-fancy-chat-question-dismiss": "", onClick: () => onDismiss(question.questionId), children: labels.questionDismiss }) : null
          ] }) })
        ] }) : null
      ] })
    }
  );
}
function useExpanded(expanded, onExpandedChange, initial = false) {
  const [own, setOwn] = useState(initial);
  const value = expanded ?? own;
  const set = (v) => {
    if (expanded === void 0) setOwn(v);
    onExpandedChange?.(v);
  };
  return [value, set];
}
function ThinkingBlock({ entry, expanded, onExpandedChange, labels: l }) {
  const labels = mergeLabels(l);
  const [open, setOpen] = useExpanded(expanded, onExpandedChange);
  return /* @__PURE__ */ jsxs("div", { "data-fancy-chat-thinking": entry.thinkingId ?? entry.runId, "data-fancy-chat-thinking-live": entry.live ? "true" : "false", className: "flex flex-col gap-1", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsx(Badge, { color: entry.live ? "violet" : "zinc", variant: "soft", size: "sm", dot: entry.live, children: entry.live ? labels.thinkingLive : labels.thinking }),
      /* @__PURE__ */ jsx(Button, { size: "xs", variant: "ghost", "data-fancy-chat-thinking-toggle": "", "aria-expanded": open, onClick: () => setOpen(!open), children: open ? labels.hideThinking : labels.showThinking })
    ] }),
    open ? /* @__PURE__ */ jsx("div", { "data-fancy-chat-thinking-text": "", className: "border-l-2 border-zinc-200 pl-3 text-sm opacity-80 dark:border-zinc-700", children: /* @__PURE__ */ jsx(ContentRenderer, { value: entry.text, format: "markdown", streaming: entry.live }) }) : null
  ] });
}
function ToolOutput({ text, language, failure, cut, labels }) {
  const code = language !== null && language !== "" && language !== "text";
  return /* @__PURE__ */ jsxs("div", { "data-fancy-chat-tool-output": "", "data-fancy-chat-tool-output-language": language ?? void 0, className: failure ? "rounded border border-red-200 p-2 dark:border-red-900" : void 0, children: [
    code ? /* @__PURE__ */ jsx(CodeBlock, { code: text, language }) : /* @__PURE__ */ jsx(Text, { className: `whitespace-pre-wrap break-words font-mono text-xs ${failure ? "text-red-700 dark:text-red-400" : ""}`, children: text }),
    cut ? /* @__PURE__ */ jsx(Text, { "data-fancy-chat-tool-output-truncated": "", className: "mt-1 text-xs opacity-70", children: labels.toolOutputTruncated }) : null
  ] });
}
var OUTCOME_COLOR = { running: "sky", ok: "emerald", failure: "red", refusal: "zinc" };
function ToolRow({ entry, expanded, onExpandedChange, onRetry, renderOutput, resolveOutput, maxOutputChars = 4e3, labels: l }) {
  const labels = mergeLabels(l);
  const [open, setOpen] = useExpanded(expanded, onExpandedChange);
  const outcome = entry.outcome ?? "running";
  const [loaded, setLoaded] = useState({ status: "idle" });
  const ref = entry.outputRef;
  useEffect(() => {
    if (!open || !resolveOutput || !ref || loaded.status !== "idle") return;
    let live = true;
    setLoaded({ status: "loading" });
    Promise.resolve().then(() => resolveOutput(ref, entry)).then(
      (r) => {
        if (!live) return;
        if (typeof r === "string") setLoaded({ status: "done", text: r, language: null });
        else if (r && typeof r.text === "string") setLoaded({ status: "done", text: r.text, language: typeof r.language === "string" ? r.language : null });
        else setLoaded({ status: "error" });
      },
      () => {
        if (live) setLoaded({ status: "error" });
      }
    );
    return () => {
      live = false;
    };
  }, [open, ref, resolveOutput]);
  const full = loaded.status === "done" ? loaded : null;
  const text = full ? full.text : entry.output ?? null;
  const language = full ? full.language : entry.outputLanguage ?? null;
  const failure = outcome === "failure";
  const showOutput = text !== null && (failure || open);
  const shown = text !== null && text.length > maxOutputChars ? text.slice(0, maxOutputChars) : text;
  const cut = text !== null && (text.length > maxOutputChars || entry.truncated && !full);
  const outcomeLabel = { running: labels.toolRunning, ok: labels.toolOk, failure: labels.toolFailure, refusal: labels.toolRefusal }[outcome];
  return /* @__PURE__ */ jsxs("div", { "data-fancy-chat-tool": entry.toolCallId, "data-fancy-chat-tool-name": entry.name, "data-fancy-chat-tool-outcome": outcome, className: "flex flex-col gap-1", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center gap-2 text-sm", children: [
      /* @__PURE__ */ jsx(Badge, { color: "zinc", variant: "outline", size: "sm", children: entry.name }),
      /* @__PURE__ */ jsx(Badge, { color: OUTCOME_COLOR[outcome] ?? "zinc", variant: outcome === "failure" ? "solid" : "soft", size: "sm", dot: outcome === "running", children: outcomeLabel }),
      entry.durationMs !== null ? (
        // `durationExact: false`: the backend bounded the time rather than measuring it.
        /* @__PURE__ */ jsx(Text, { className: "text-xs", "data-fancy-chat-tool-duration": "", "data-fancy-chat-tool-duration-exact": entry.durationExact === false ? "false" : "true", children: entry.durationExact === false ? labels.durationAtMost(labels.durationMs(entry.durationMs)) : labels.durationMs(entry.durationMs) })
      ) : null,
      /* @__PURE__ */ jsx(Button, { size: "xs", variant: "ghost", "data-fancy-chat-tool-toggle": "", "aria-expanded": open, onClick: () => setOpen(!open), children: open ? labels.showLess : labels.showMore }),
      outcome === "failure" && onRetry ? /* @__PURE__ */ jsx(Button, { size: "xs", "data-fancy-chat-tool-retry": "", onClick: () => onRetry(entry.toolCallId), children: labels.toolRetry }) : null
    ] }),
    outcome === "running" && entry.progress ? /* @__PURE__ */ jsxs("div", { "data-fancy-chat-tool-progress": "", className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsx(Progress, { value: entry.progress.fraction !== null ? Math.round(entry.progress.fraction * 100) : void 0, indeterminate: entry.progress.fraction === null, size: "sm" }),
      entry.progress.text ? /* @__PURE__ */ jsx(Text, { className: "text-xs", children: entry.progress.text }) : null
    ] }) : null,
    showOutput && shown !== null ? /* @__PURE__ */ jsx(ToolOutput, { text: shown, language, failure, cut, labels }) : null,
    open && loaded.status === "loading" ? /* @__PURE__ */ jsx(Text, { "data-fancy-chat-tool-output-loading": "", className: "text-xs opacity-70", children: labels.toolOutputLoading }) : null,
    open && loaded.status === "error" ? /* @__PURE__ */ jsx(Text, { "data-fancy-chat-tool-output-error": "", className: "text-xs text-red-600", children: labels.toolOutputError }) : null,
    open ? /* @__PURE__ */ jsxs("div", { "data-fancy-chat-tool-args": "", children: [
      /* @__PURE__ */ jsx(CodeBlock, { code: JSON.stringify(entry.args, null, 2), language: "json", title: labels.toolArgs }),
      renderOutput ? renderOutput(entry) : null
    ] }) : null
  ] });
}
function PlanRow({ entry, onShowApproval, labels: l }) {
  const labels = mergeLabels(l);
  const done = entry.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const doing = entry.steps.find((s) => s.status === "running" || s.status === "held");
  return /* @__PURE__ */ jsxs("div", { "data-fancy-chat-plan": entry.runId, className: "flex flex-col gap-1 text-sm", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsx(Badge, { color: "indigo", variant: "soft", size: "sm", children: labels.plan(done, entry.steps.length) }),
      doing ? /* @__PURE__ */ jsx(Text, { className: "text-xs", children: doing.title }) : null
    ] }),
    /* @__PURE__ */ jsx("ol", { className: "flex flex-col gap-0.5 pl-4", children: entry.steps.map((s) => /* @__PURE__ */ jsxs("li", { "data-fancy-chat-plan-step": s.id, "data-fancy-chat-plan-step-status": s.status, "data-fancy-chat-plan-step-owner": s.owner, children: [
      s.title,
      s.status === "held" && s.approvalId && onShowApproval ? /* @__PURE__ */ jsx(Button, { size: "xs", variant: "ghost", className: "ms-2", "data-fancy-chat-plan-step-approval": s.approvalId, onClick: () => onShowApproval(s.approvalId), children: labels.heldOnApproval }) : null
    ] }, s.id)) })
  ] });
}
var isTool = (e) => "toolCallId" in e;
var TONE = { neutral: "zinc", running: "sky", ok: "emerald", failure: "red", refusal: "zinc" };
function ActivityTimeline({ id, entries, running, expanded, onExpandedChange, toolRowProps, labels: l }) {
  const labels = mergeLabels(l);
  const [toggled, setToggled] = useState(null);
  const open = expanded ?? toggled ?? running;
  const set = (v) => {
    if (expanded === void 0) setToggled(v);
    onExpandedChange?.(v);
  };
  const tools = entries.filter(isTool);
  const totalMs = tools.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
  const failedTools = tools.filter((t) => t.outcome === "failure");
  const failed = failedTools.length;
  const exact = tools.every((t) => t.durationMs === null || t.durationExact !== false);
  const summary = labels.activitySummary(tools.length, (totalMs / 1e3).toFixed(1), failed, exact);
  return /* @__PURE__ */ jsxs("div", { "data-fancy-chat-activity": id, "data-fancy-chat-activity-expanded": open ? "true" : "false", "data-fancy-chat-activity-running": running ? "true" : "false", className: "flex flex-col gap-1", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center gap-2 text-sm", children: [
      /* @__PURE__ */ jsx(Badge, { color: failed > 0 ? "red" : running ? "sky" : "zinc", variant: "soft", size: "sm", dot: running, children: /* @__PURE__ */ jsx("span", { "data-fancy-chat-activity-summary": "", children: summary }) }),
      /* @__PURE__ */ jsx(Button, { size: "xs", variant: "ghost", "data-fancy-chat-activity-toggle": "", "aria-expanded": open, onClick: () => set(!open), children: open ? labels.hideActivity : labels.showActivity })
    ] }),
    !open && failedTools.length > 0 ? (
      // Collapsed, a failure still shows: its row, whose failure text needs no expanding.
      /* @__PURE__ */ jsx("div", { "data-fancy-chat-activity-failures": "", className: "flex flex-col gap-1", children: failedTools.map((t) => /* @__PURE__ */ jsx(ToolRow, { entry: t, ...toolRowProps, labels: l }, t.toolCallId)) })
    ) : null,
    open ? (
      // Not animated: an animated item stays hidden until it scrolls into view, and a
      // chat's activity must be readable the moment it lands (and in a virtual list).
      /* @__PURE__ */ jsx(Timeline, { animated: false, children: entries.map((e) => {
        const tone = isTool(e) ? e.outcome ?? "running" : "neutral";
        return /* @__PURE__ */ jsx(Timeline.Item, { color: TONE[tone] ?? "zinc", active: tone === "running", children: /* @__PURE__ */ jsx("div", { "data-fancy-chat-activity-item": "", "data-fancy-chat-activity-tone": tone, children: isTool(e) ? /* @__PURE__ */ jsx(ToolRow, { entry: e, ...toolRowProps, labels: l }) : /* @__PURE__ */ jsx(ThinkingBlock, { entry: e, labels: l }) }) }, isTool(e) ? `tool:${e.toolCallId}` : `thinking:${e.thinkingId ?? e.runId}`);
      }) })
    ) : null
  ] });
}
function ModelError({ turn, onRetry, labels: l }) {
  const labels = mergeLabels(l);
  if (turn.state !== "settled" || turn.outcome !== "failed" && turn.outcome !== "refused") return null;
  const failed = turn.outcome === "failed";
  return /* @__PURE__ */ jsxs("div", { "data-fancy-chat-turn-error": turn.turnId, "data-fancy-chat-turn-error-tone": failed ? "failure" : "neutral", role: "status", className: "flex flex-wrap items-center gap-2 text-sm", children: [
    /* @__PURE__ */ jsx(Badge, { color: failed ? "red" : "zinc", variant: "soft", size: "sm", children: failed ? labels.turnFailed(turn.reason) : labels.turnRefused }),
    failed && onRetry ? /* @__PURE__ */ jsx(Button, { size: "xs", "data-fancy-chat-turn-retry": "", onClick: () => onRetry(turn.turnId), children: labels.turnRetry }) : null
  ] });
}
function actionableIn(state, kinds = ["approval", "question"]) {
  const items = state.order.map((o, index) => ({ o, index })).filter(({ o }) => o.kind === "approval" || o.kind === "question").map(({ o, index }) => {
    const record = o.kind === "approval" ? state.approvals.find((a) => a.approvalId === o.id) : state.questions.find((q) => q.questionId === o.id);
    return { id: o.id, kind: o.kind, state: String(record?.state ?? "open"), seq: index };
  });
  return pickActionable(items, kinds);
}
function UndoCountdown({ entry, onRevert, now: fixedNow, tickMs = 250, totalMs, labels: l }) {
  const labels = mergeLabels(l);
  const [ownNow, setOwnNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (fixedNow !== void 0 || entry.state !== "open") return;
    const id = setInterval(() => setOwnNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [fixedNow, entry.state, tickMs]);
  const now = fixedNow ?? ownNow;
  const { remainingMs, canRevert } = undoWindow(entry, now);
  const seconds = Math.ceil(remainingMs / 1e3);
  const revert = () => {
    if (!onRevert || busy || !canRevert) return;
    setBusy(true);
    const r = onRevert(entry.actionId);
    if (r && typeof r.then === "function") r.then(() => setBusy(false), () => setBusy(false));
    else setBusy(false);
  };
  return /* @__PURE__ */ jsxs("div", { "data-fancy-chat-undo": entry.actionId, "data-fancy-chat-undo-state": entry.state, "data-fancy-chat-undo-remaining": remainingMs, className: "flex flex-wrap items-center gap-2 text-sm", children: [
    /* @__PURE__ */ jsx(Badge, { color: entry.state === "reverted" ? "zinc" : entry.state === "committed" ? "emerald" : "amber", variant: "soft", size: "sm", children: entry.state === "open" ? labels.undoOpen(seconds) : entry.state === "committed" ? labels.undoCommitted : labels.undoReverted }),
    /* @__PURE__ */ jsx(Text, { children: entry.label }),
    entry.state === "open" && totalMs ? /* @__PURE__ */ jsx(Progress, { value: Math.max(0, Math.min(100, Math.round(remainingMs / totalMs * 100))), size: "sm" }) : null,
    entry.state === "open" && onRevert ? /* @__PURE__ */ jsx(Button, { size: "xs", "data-fancy-chat-undo-revert": "", disabled: !canRevert || busy, onClick: revert, children: labels.undoRevert }) : null
  ] });
}
var EARLIER_ID = "__fancy_chat_earlier__";
function AgentThread(props) {
  const {
    rows,
    state,
    follow,
    onFollowChange,
    scrollToId,
    onScrollToIdResolved,
    onLoadEarlier,
    hasEarlier = true,
    height = "100%",
    estimateRowHeight = 72,
    ownRoles = ["user"],
    timeOf,
    onDecide,
    questionDrafts,
    onQuestionDraftChange,
    onAnswer,
    actionableKinds: actionableKindsProp,
    expanded,
    onExpandedChange,
    onRetryTool,
    partViewProps,
    renderRow,
    renderApproval: renderApprovalProp,
    className,
    profile,
    onEdit,
    onRevertUndo,
    onShowApproval,
    now,
    resolveToolOutput,
    renderToolOutput,
    maxToolOutputChars,
    activity = "rows",
    onRetryTurn,
    chat
  } = props;
  const chatRetry = chat?.retry;
  const retryTurn = onRetryTurn ?? (chatRetry ? (turnId) => void chatRetry(turnId) : void 0);
  const actionableKinds = actionableKindsProp ?? profile?.hitl?.actionable ?? ["approval", "question"];
  const [ownShowBranches, setOwnShowBranches] = useState(false);
  const showBranches = props.onShowBranchesChange ? props.showBranches ?? false : props.showBranches ?? ownShowBranches;
  const setShowBranches = (v) => props.onShowBranchesChange ? props.onShowBranchesChange(v) : setOwnShowBranches(v);
  const partProps = profile?.parts ? { ...partViewProps, allowedKinds: profile.parts } : partViewProps;
  const labels = mergeLabels(props.labels);
  const [unseen, setUnseen] = useState(0);
  const [ownDrafts, setOwnDrafts] = useState({});
  const drafts = questionDrafts ?? ownDrafts;
  const actionableId = actionableIn(state, actionableKinds);
  const branchOf = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    for (const b of state.branches ?? []) {
      map.set(b.supersededId, b.supersededId);
      for (const id of b.rowIds) if (!map.has(id)) map.set(id, b.supersededId);
    }
    return map;
  }, [state, rows]);
  const branchToggleAt = useMemo(() => new Map((state.branches ?? []).map((b) => [b.byId, b.supersededId])), [state, rows]);
  const items = useMemo(() => {
    const visible = rows.filter((r) => !(r.kind === "message" && r.retracted)).filter((r) => showBranches || !branchOf.has(r.id)).reduce((out, r) => {
      if (activity === "timeline" && (r.kind === "thinking" || r.kind === "tool")) {
        const run = r.runId ?? "_";
        const last = out[out.length - 1];
        const lastRun = last?.group ? last.group[0].runId ?? "_" : null;
        if (last?.group && lastRun === run) {
          last.group.push(r);
          return out;
        }
        out.push({ id: `activity:${r.id}`, row: null, group: [r] });
        return out;
      }
      out.push({ id: r.id, row: r });
      return out;
    }, []);
    return onLoadEarlier && hasEarlier ? [{ id: EARLIER_ID, row: null }, ...visible] : visible;
  }, [rows, onLoadEarlier, hasEarlier, showBranches, branchOf, activity]);
  const lastTurn = state.turns.length > 0 ? state.turns[state.turns.length - 1] : void 0;
  const approvalResults = /* @__PURE__ */ new Map();
  const isApprovalActionable = (approvalId) => !!onDecide && actionableId === approvalId;
  const customApproval = (record) => {
    if (!renderApprovalProp) return void 0;
    if (!approvalResults.has(record.approvalId)) {
      approvalResults.set(
        record.approvalId,
        renderApprovalProp(record, {
          actionable: isApprovalActionable(record.approvalId),
          onDecide: onDecide ?? (() => {
          }),
          labels
        })
      );
    }
    return approvalResults.get(record.approvalId);
  };
  const renderApproval = (approvalId) => {
    const record = state.approvals.find((a) => a.approvalId === approvalId);
    if (!record) return null;
    const actionable = isApprovalActionable(approvalId);
    const custom = customApproval(record);
    if (custom !== void 0) {
      const handle = {
        "data-fancy-chat-approval": record.approvalId,
        "data-fancy-chat-approval-state": record.state,
        "data-fancy-chat-approval-actionable": actionable && record.state === "pending" ? "true" : "false"
      };
      return custom === null ? /* @__PURE__ */ jsx(HiddenHitl, { ...handle }) : /* @__PURE__ */ jsx("div", { ...handle, children: custom });
    }
    return /* @__PURE__ */ jsx(
      ApprovalCard,
      {
        record,
        actionable,
        onDecide: onDecide ?? (() => {
        }),
        labels: props.labels,
        partViewProps: partProps
      }
    );
  };
  const approvalIsNull = (approvalId) => {
    const record = state.approvals.find((a) => a.approvalId === approvalId);
    return !!record && customApproval(record) === null;
  };
  const isCollapsed = (item) => {
    const row = item.row;
    if (!renderApprovalProp || !row || row.kind !== "approval" && row.kind !== "message") return false;
    if (renderRow?.(row) !== void 0) return false;
    if (row.kind === "approval") return approvalIsNull(row.approvalId);
    if (row.parts.length === 0 || row.open.length > 0 || row.superseded || row.author?.kind === "human" || branchToggleAt.has(row.id)) return false;
    if (row.delivery && row.delivery !== "sent" && row.delivery !== "delivered" || partProps?.renderers?.approval) return false;
    if (partProps?.allowedKinds && !partProps.allowedKinds.includes("approval")) return false;
    return row.parts.every((part) => part.kind === "approval" && approvalIsNull(String(part.approvalId)));
  };
  const renderQuestion = (questionId) => {
    const record = state.questions.find((q) => q.questionId === questionId);
    if (!record) return null;
    return /* @__PURE__ */ jsx(
      QuestionForm,
      {
        question: record,
        draft: drafts[questionId] ?? { values: {}, notes: {} },
        onDraftChange: (d) => onQuestionDraftChange ? onQuestionDraftChange(questionId, d) : setOwnDrafts((all) => ({ ...all, [questionId]: d })),
        onSubmit: onAnswer ?? (() => {
        }),
        actionable: !!onAnswer && actionableId === questionId,
        labels: props.labels
      }
    );
  };
  const renderHitl = (part) => part.kind === "approval" ? renderApproval(String(part.approvalId)) : part.kind === "question" ? renderQuestion(String(part.questionId)) : null;
  const renderMessage = (m) => {
    const streaming = m.open.length > 0;
    const status = m.delivery === "failed" ? "failed" : m.delivery === "sending" ? "pending" : streaming ? "streaming" : "sent";
    const message = {
      id: m.id,
      role: m.role,
      ...m.author ? { author: { name: m.author.label ?? m.author.id } } : {},
      content: "",
      createdAt: timeOf?.(m) ?? "",
      status
    };
    const body = /* @__PURE__ */ jsx("div", { className: "flex flex-col gap-2", children: m.parts.map((part) => /* @__PURE__ */ jsx(PartView, { ...partProps, part, streaming: m.open.includes(part.id), renderHitl, labels: props.labels }, part.id)) });
    return /* @__PURE__ */ jsxs(
      "div",
      {
        "data-fancy-chat-message": m.id,
        "data-fancy-chat-delivery": m.delivery ?? void 0,
        "data-fancy-chat-superseded": m.superseded ? "true" : "false",
        "data-fancy-chat-turn": m.turnId ?? void 0,
        "data-fancy-chat-branch": branchOf.get(m.id),
        className: m.superseded ? "opacity-60" : void 0,
        children: [
          /* @__PURE__ */ jsx(
            ChatMessage,
            {
              message,
              ownRoles,
              body,
              actions: onEdit && m.author?.kind === "human" && ownRoles.includes(m.role) && !m.superseded && !m.retracted ? /* @__PURE__ */ jsx(Button, { size: "xs", variant: "ghost", "data-fancy-chat-edit": m.id, onClick: () => onEdit(m), children: labels.edit }) : void 0,
              labels: { pending: labels.delivery.sending ?? "Sending", failed: labels.delivery.failed ?? "Not sent" }
            }
          ),
          branchToggleAt.has(m.id) ? /* @__PURE__ */ jsx(Button, { size: "xs", variant: "ghost", "data-fancy-chat-branch-toggle": branchToggleAt.get(m.id), "aria-pressed": showBranches, onClick: () => setShowBranches(!showBranches), children: showBranches ? labels.hideEarlierVersion : labels.showEarlierVersion }) : null,
          m.delivery && m.delivery !== "sent" && m.delivery !== "delivered" && m.delivery !== "sending" && m.delivery !== "failed" ? /* @__PURE__ */ jsx("div", { "data-fancy-chat-delivery-label": "", className: "mt-0.5 text-xs opacity-70", children: labels.delivery[m.delivery] ?? m.delivery }) : null,
          m.superseded ? /* @__PURE__ */ jsx("div", { className: "mt-0.5 text-xs opacity-70", children: labels.superseded }) : null
        ]
      }
    );
  };
  const toolRowProps = {
    ...resolveToolOutput ? { resolveOutput: resolveToolOutput } : {},
    ...renderToolOutput ? { renderOutput: renderToolOutput } : {},
    ...maxToolOutputChars !== void 0 ? { maxOutputChars: maxToolOutputChars } : {},
    ...onRetryTool ? { onRetry: onRetryTool } : {}
  };
  const renderOne = (item) => {
    if (item.group) {
      const running = item.group.some((e) => "toolCallId" in e ? e.outcome === null : e.live);
      return /* @__PURE__ */ jsx("div", { "data-fancy-chat-row": "activity", className: "px-3 py-1.5", children: /* @__PURE__ */ jsx(
        ActivityTimeline,
        {
          id: item.id.slice("activity:".length),
          entries: item.group,
          running,
          expanded: expanded?.[item.id],
          onExpandedChange: onExpandedChange ? (v) => onExpandedChange(item.id, v) : void 0,
          toolRowProps,
          labels: props.labels
        }
      ) });
    }
    if (!item.row) {
      return /* @__PURE__ */ jsx("div", { className: "flex justify-center py-2", children: /* @__PURE__ */ jsx(Button, { size: "sm", variant: "ghost", "data-fancy-chat-load-earlier": "", onClick: onLoadEarlier, children: labels.loadEarlier }) });
    }
    const row = item.row;
    const custom = renderRow?.(row);
    if (custom !== void 0) return /* @__PURE__ */ jsx("div", { "data-fancy-chat-row": row.kind, children: custom });
    const open = expanded?.[row.id];
    const setOpen = onExpandedChange ? (v) => onExpandedChange(row.id, v) : void 0;
    let body = null;
    switch (row.kind) {
      case "message":
        body = renderMessage(row);
        break;
      case "thinking":
        body = /* @__PURE__ */ jsx(ThinkingBlock, { entry: row, expanded: open, onExpandedChange: setOpen, labels: props.labels });
        break;
      case "tool":
        body = /* @__PURE__ */ jsx(ToolRow, { entry: row, expanded: open, onExpandedChange: setOpen, ...toolRowProps, labels: props.labels });
        break;
      case "plan":
        body = /* @__PURE__ */ jsx(PlanRow, { entry: row, onShowApproval, labels: props.labels });
        break;
      case "approval":
        body = renderApproval(row.approvalId);
        break;
      case "question":
        body = renderQuestion(row.questionId);
        break;
      case "undo":
        body = /* @__PURE__ */ jsx(UndoCountdown, { entry: row, onRevert: onRevertUndo, now, labels: props.labels });
        break;
    }
    return /* @__PURE__ */ jsx("div", { "data-fancy-chat-row": row.kind, "data-fancy-chat-branch": branchOf.get(row.id), className: "px-3 py-1.5", children: body });
  };
  const collapsed = renderApprovalProp ? items.filter(isCollapsed) : [];
  const collapsedKey = JSON.stringify(collapsed.map((item) => item.id));
  const listItems = useMemo(() => {
    const ids = new Set(JSON.parse(collapsedKey));
    return ids.size === 0 ? items : items.filter((item) => !ids.has(item.id));
  }, [items, collapsedKey]);
  return /* @__PURE__ */ jsxs("div", { "data-fancy-chat-thread": "", "data-fancy-chat-following": follow ? "true" : "false", className: ["relative flex min-h-0 flex-col", className].filter(Boolean).join(" "), style: { height }, children: [
    collapsed.length > 0 ? /* @__PURE__ */ jsx("div", { hidden: true, "data-fancy-chat-hidden-rows": "", children: collapsed.map((item) => /* @__PURE__ */ jsx("div", { children: renderOne(item) }, item.id)) }) : null,
    /* @__PURE__ */ jsx(
      VirtualList,
      {
        id: "fancy-chat-thread",
        "aria-label": labels.thread,
        items: listItems,
        renderRow: renderOne,
        height: "100%",
        estimateRowHeight,
        followTail: follow,
        onFollowChange,
        onUnseenChange: setUnseen,
        scrollToId: scrollToId ?? null,
        onScrollToIdResolved,
        anchorOnPrepend: true
      }
    ),
    lastTurn ? /* @__PURE__ */ jsx("div", { className: "px-3 py-1", children: /* @__PURE__ */ jsx(ModelError, { turn: lastTurn, onRetry: retryTurn, labels: props.labels }) }) : null,
    !follow ? /* @__PURE__ */ jsx("div", { className: "pointer-events-none absolute inset-x-0 bottom-2 flex justify-center", children: /* @__PURE__ */ jsx(Button, { size: "sm", className: "pointer-events-auto", "data-fancy-chat-jump": "", "data-fancy-chat-unseen": unseen, onClick: () => onFollowChange(true), children: labels.jumpToLatest(unseen) }) }) : null
  ] });
}
var EMPTY_PROMPT_DRAFT = { v: 1, text: "", pills: [], attachments: [] };
function AgentComposer(props) {
  const { threadId, drafts, onDraftsChange, onSend, running = false, onStop, canStop = true, outcome, commands, mentions, budgetTokens = 0, usedTokens, meter = "hidden", aboveInput, attachments = true, disabled, placeholder, className } = props;
  const labels = mergeLabels(props.labels);
  const draft = drafts[threadId] ?? EMPTY_PROMPT_DRAFT;
  const triggers = props.triggers ? Array.isArray(props.triggers) ? props.triggers : props.triggers.triggers() : void 0;
  const typed = props.typedApproval ? matchTypedApproval(draft.text, props.typedApproval.approval, props.typedApproval.config) : null;
  const submit = async (text, attachments2) => {
    const result = await onSend({ threadId, text, attachments: attachments2 });
    if (result && result.ok === false) return { ok: false, ...result.error ? { error: result.error } : {} };
    return void 0;
  };
  const outcomeText = outcome ? outcome.delivery === "failed" ? labels.sendFailed(outcome.reason ?? labels.delivery.failed ?? "failed") : (labels.delivery[outcome.delivery] ?? outcome.delivery) + (outcome.reason ? ` (${outcome.reason})` : "") : null;
  return /* @__PURE__ */ jsxs("div", { "data-fancy-chat-composer": threadId, "data-fancy-chat-running": running ? "true" : "false", "data-fancy-chat-can-stop": canStop ? "true" : "false", className, children: [
    /* @__PURE__ */ jsx(
      PromptInput,
      {
        draft,
        draftKey: threadId,
        onDraftChange: (d) => onDraftsChange({ ...drafts, [threadId]: d }),
        onSubmit: submit,
        running,
        onStop: canStop ? onStop : void 0,
        commands,
        mentions,
        triggers,
        budgetTokens,
        usedTokens,
        meter,
        aboveInput,
        attachments,
        disabled,
        placeholder: placeholder ?? labels.composerPlaceholder,
        labels: { stop: labels.stop }
      }
    ),
    typed ? /* @__PURE__ */ jsx("div", { "data-fancy-chat-typed-approval": typed.decision, role: "status", className: "mt-1 text-xs text-amber-700 dark:text-amber-400", children: labels.typedApproval(typed.decision) }) : null,
    outcomeText ? /* @__PURE__ */ jsx("div", { "data-fancy-chat-send-outcome": "", "data-fancy-chat-delivery": outcome?.delivery, role: "status", className: outcome?.delivery === "failed" ? "mt-1 text-xs text-red-600 dark:text-red-400" : "mt-1 text-xs opacity-70", children: outcomeText }) : null
  ] });
}
function useAgentThread(options) {
  const { transport, initial, nudge, actionableKinds, store: shared } = options;
  const store = useMemo(() => shared ?? createThreadStore({ transport, ...initial ? { initial } : {}, ...nudge ? { nudge } : {} }), [transport, shared]);
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  useEffect(() => {
    if (!initial || !(initial.lastSeq > store.getSnapshot().lastSeq)) return;
    store.ingest([
      {
        v: 1,
        seq: initial.lastSeq,
        threadId: "",
        at: (/* @__PURE__ */ new Date()).toISOString(),
        type: "thread.snapshot",
        actor: { kind: "system", id: "fancy-chat-ui" },
        data: { snapshot: initial }
      }
    ]);
  }, [initial, store]);
  const [capabilities, setCapabilities] = useState(null);
  useEffect(() => {
    setCapabilities(null);
    if (!transport.capabilities) return;
    let live = true;
    transport.capabilities().then(
      (c) => {
        if (live && c && typeof c.cancel === "boolean") setCapabilities(c);
      },
      () => {
      }
    );
    return () => {
      live = false;
    };
  }, [transport]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const kinds = actionableKinds ?? ["approval", "question"];
  const kindsKey = kinds.join(",");
  const actionableId = useMemo(() => actionableIn(snapshot.state, kindsKey.split(",")), [snapshot.version, kindsKey]);
  const activeTurn = useMemo(() => [...snapshot.state.turns].reverse().find((t) => t.state !== "settled") ?? null, [snapshot.version]);
  const send = useCallback((input) => transport.send(input), [transport]);
  const cancel = useCallback((mode) => transport.cancel(mode), [transport]);
  const unsend = useCallback((id) => transport.unsend(id), [transport]);
  const retry = useCallback(
    (turnId) => transport.retry ? transport.retry(turnId) : Promise.reject(new Error("This chat transport cannot retry a turn (no transport.retry).")),
    [transport]
  );
  const revertUndo = useCallback((id) => transport.revertUndo(id), [transport]);
  const decide = useCallback(
    (input) => transport.decide(input.approvalId, {
      optionId: input.optionId,
      ...input.note ? { note: input.note } : {},
      ...input.edited !== void 0 ? { edited: input.edited } : {}
    }),
    [transport]
  );
  const answer = useCallback((input) => transport.answer(input.questionId, { values: input.values, notes: input.notes }), [transport]);
  return { ...snapshot, store, actionableId, activeTurn, send, cancel, unsend, revertUndo, decide, answer, capabilities, retry };
}
function queuedMessages(state) {
  return state.messages.filter((m) => m.delivery === "queued" && !m.retracted);
}
function QueueBar(props) {
  const { messages, onUnsend, onSendAll, onDiscardAll, onSendNow, onInterruptAndSend, queuedAt, now, sendNowAfterMs = 12e4 } = props;
  const labels = mergeLabels(props.labels);
  if (messages.length === 0) return null;
  return /* @__PURE__ */ jsxs("div", { "data-fancy-chat-queue": "", "data-fancy-chat-queue-count": messages.length, className: "flex flex-col gap-1 rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-700", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
      /* @__PURE__ */ jsx(Badge, { color: "amber", variant: "soft", size: "sm", children: labels.queued(messages.length) }),
      onSendAll ? /* @__PURE__ */ jsx(Button, { size: "xs", "data-fancy-chat-queue-send-all": "", onClick: onSendAll, children: labels.queueSendAll }) : null,
      onDiscardAll ? /* @__PURE__ */ jsx(Button, { size: "xs", variant: "ghost", "data-fancy-chat-queue-discard": "", onClick: onDiscardAll, children: labels.queueDiscard }) : null
    ] }),
    /* @__PURE__ */ jsx("ul", { className: "flex flex-col gap-1", children: messages.map((m) => {
      const at = queuedAt?.(m);
      const waited = at !== void 0 && now !== void 0 ? now - at : 0;
      const canSendNow = !!onSendNow && at !== void 0 && now !== void 0 && waited >= sendNowAfterMs;
      const text = m.parts.map((p) => partToText(p)).join(" ");
      return /* @__PURE__ */ jsxs("li", { "data-fancy-chat-queued": m.id, className: "flex items-center gap-2", children: [
        /* @__PURE__ */ jsx(Text, { className: "min-w-0 flex-1 truncate", children: text }),
        canSendNow ? /* @__PURE__ */ jsx(Button, { size: "xs", "data-fancy-chat-queue-send-now": m.id, onClick: () => onSendNow?.(m.id), children: labels.queueSendNow }) : null,
        onInterruptAndSend ? /* @__PURE__ */ jsx(Button, { size: "xs", color: "amber", "data-fancy-chat-queue-interrupt": m.id, onClick: () => onInterruptAndSend(m.id), children: labels.queueInterrupt }) : null,
        /* @__PURE__ */ jsx(Button, { size: "xs", variant: "ghost", "data-fancy-chat-queue-unsend": m.id, onClick: () => onUnsend(m.id), children: labels.queueUnsend })
      ] }, m.id);
    }) })
  ] });
}

// src/triggers.ts
var PILL_KIND = /^[a-z][a-z0-9-]*$/;
function pillField(value) {
  let out = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (ch === "[" || ch === "]" || ch === "|" || code < 32 || code === 127) out += " ";
    else out += ch;
  }
  return out.trim();
}
function serializePill(ref) {
  if (!PILL_KIND.test(ref.kind)) throw new TypeError(`A pill kind is lower case letters, digits and dashes: "${ref.kind}".`);
  const target = pillField(ref.target).replace(/:/g, " ");
  return `[${ref.kind}:${target}|${pillField(ref.label) || target}]`;
}
function createTriggerRegistry(definitions = []) {
  const byChar = /* @__PURE__ */ new Map();
  const registry = {
    register(definition) {
      if ([...definition.char].length !== 1) throw new TypeError("A trigger is exactly one character.");
      if (byChar.has(definition.char)) throw new TypeError(`The trigger "${definition.char}" is already registered.`);
      if (!PILL_KIND.test(definition.kind)) throw new TypeError(`A pill kind is lower case letters, digits and dashes: "${definition.kind}".`);
      byChar.set(definition.char, definition);
      return registry;
    },
    triggers: () => [...byChar.values()].map((d) => ({
      char: d.char,
      ...d.label ? { label: d.label } : {},
      ...d.wordStart !== void 0 ? { wordStart: d.wordStart } : {},
      search: async (query) => {
        const found = await d.search(query);
        return (Array.isArray(found) ? found : []).map((item) => d.toItem ? d.toItem(item) : item);
      },
      serialize: (item) => serializePill({ kind: d.kind, target: d.toTarget ? d.toTarget(item) : item.id, label: item.label })
    })),
    chars: () => [...byChar.keys()]
  };
  for (const d of definitions) registry.register(d);
  return registry;
}
var PROFILE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
var EXTENSION_KIND = /^x-[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9._-]*$/;
function defineSurfaceProfile(profile) {
  if (!PROFILE_ID.test(profile.id)) throw new TypeError(`A surface profile id is lower case, up to 64 characters: "${profile.id}".`);
  for (const kind of profile.parts ?? []) {
    if (!CORE_PART_KINDS.includes(kind) && !EXTENSION_KIND.test(kind)) {
      throw new TypeError(`Unknown part kind in profile "${profile.id}": "${kind}".`);
    }
  }
  for (const kind of profile.hitl?.actionable ?? []) {
    if (kind !== "approval" && kind !== "question") throw new TypeError(`Unknown HITL kind in profile "${profile.id}": "${String(kind)}".`);
  }
  if (profile.layout && profile.layout !== "docked" && profile.layout !== "overlay" && profile.layout !== "page") {
    throw new TypeError(`Unknown layout in profile "${profile.id}": "${String(profile.layout)}".`);
  }
  return Object.freeze({ ...profile });
}
function profileAllowsPart(profile, kind) {
  return !profile?.parts || profile.parts.includes(kind);
}

export { ActivityTimeline, AgentComposer, AgentThread, ApprovalCard, DEFAULT_LABELS, EMPTY_PROMPT_DRAFT, ModelError, PartView, PlanRow, QuestionForm, QueueBar, ThinkingBlock, ToolRow, UndoCountdown, actionableIn, createHttpTransport, createThreadStore, createTriggerRegistry, defineSurfaceProfile, mergeLabels, profileAllowsPart, queuedMessages, serializePill, useAgentThread };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map