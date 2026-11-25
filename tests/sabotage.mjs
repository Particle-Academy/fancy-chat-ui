// Break one clause at a time; the suite must notice every one. Each file is
// restored in a `finally`. Exits 1 if a mutation survives, 2 if a pattern is no
// longer in the file.
//
//   node tests/sabotage.mjs
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const file = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));

const MUTATIONS = [
  ["tone from the label", "src/ApprovalCard.tsx", ".map((o) => ({ option: o, ...optionTone(o.kind) }))", '.map((o) => ({ option: o, ...optionTone(o.label === "Reject" ? "reject-once" : o.kind) }))'],
  ["unknown option kinds offered", "src/ApprovalCard.tsx", "o.tone !== null && o.decision !== null", "true"],
  ["no in-flight lock", "src/ApprovalCard.tsx", "if (busyRef.current || !actionable || !pending) return;", "if (!actionable || !pending) return;"],
  ["non-actionable card decides", "src/ApprovalCard.tsx", "disabled={!actionable || busy}\n                  onClick", "disabled={busy}\n                  onClick"],
  ["note dropped", "src/ApprovalCard.tsx", "...(trimmed ? { note: trimmed } : {})", ""],
  ["answer ignores the required rule", "src/QuestionForm.tsx", "disabled={disabled || !check.ok}", "disabled={disabled}"],
  ["question uncontrolled value", "src/QuestionForm.tsx", "const setValue = (id: string, value: unknown) => onDraftChange(", "const setValue = (id: string, value: unknown) => void ("],
  ["answered question keeps inputs", "src/QuestionForm.tsx", "{open ? (\n          <>", "{true ? (\n          <>"],
  ["javascript card links", "src/PartView.tsx", 'a.kind === "link" && a.href && SAFE_HREF.test(a.href)', 'a.kind === "link" && a.href'],
  ["file links unresolved hrefs", "src/PartView.tsx", "const href = ref?.href && SAFE_HREF.test(ref.href) ? ref.href : null;", "const href = ref?.href ?? null;"],
  ["unknown parts dropped", "src/PartView.tsx", "{partToText(part, registry)}\n          </Badge>", "\n          </Badge>"],
  ["plain text as markdown", "src/PartView.tsx", 'part.format === "plain" ? (', "false ? ("],
  ["refusal styled as failure", "src/activity.tsx", 'outcome === "failure" && onRetry ?', '(outcome === "failure" || outcome === "refusal") && onRetry ?'],
  ["tool args always shown", "src/activity.tsx", "{open ? (\n        <div data-fancy-chat-tool-args", "{true ? (\n        <div data-fancy-chat-tool-args"],
  ["failure output hidden until expanded", "src/activity.tsx", "const showOutput = text !== null && (failure || open);", "const showOutput = text !== null && open;"],
  ["tool output unbounded on screen", "src/activity.tsx", "text !== null && text.length > maxOutputChars ? text.slice(0, maxOutputChars) : text;", "text;"],
  ["server truncation not marked", "src/activity.tsx", "(entry.truncated && !full)", "false"],
  ["output fetched while collapsed", "src/activity.tsx", "if (!open || !resolveOutput || !ref || loaded.status !== \"idle\") return;", "if (!resolveOutput || !ref || loaded.status !== \"idle\") return;"],
  ["output fetched again on rerender", "src/activity.tsx", "|| loaded.status !== \"idle\") return;", ") return;"],
  ["timeline animated (hidden until scrolled)", "src/activity.tsx", "<Timeline animated={false}>", "<Timeline>"],
  ["timeline ignores running", "src/activity.tsx", "const open = expanded ?? toggled ?? running;", "const open = expanded ?? toggled ?? false;"],
  ["refusal offers Retry", "src/activity.tsx", "{failed && onRetry ? (", "{onRetry ? ("],
  ["renderToolOutput not passed through", "src/AgentThread.tsx", "...(renderToolOutput ? { renderOutput: renderToolOutput } : {}),", ""],
  ["resolveToolOutput not passed through", "src/AgentThread.tsx", "...(resolveToolOutput ? { resolveOutput: resolveToolOutput } : {}),", ""],
  ["listFacts ignored", "src/knowledge/FactsExplorer.tsx", "    if (adapter?.listFacts) {\n      // The full listing", "    if (false) {\n      // The full listing"],
  ["listFacts accepts g282.1", "src/knowledge/shapes.ts", "readListing(input, isFact, \"fact\", G282_2_VERSION)", "readListing(input, isFact, \"fact\")"],
  ["subject does not filter the listing", "src/knowledge/FactsExplorer.tsx", "        () => list(subject || null, null, pageSize),", "        () => list(null, null, pageSize),"],
  ["listing pages replace", "src/knowledge/FactsExplorer.tsx", "setFacts((prev) => [...(prev ?? []), ...v.items]);", "setFacts(v.items);"],
  ["no more button", "src/knowledge/FactsExplorer.tsx", "{!factsError && factsCursor && adapter.listFacts ? (", "{false ? ("],
  ["explorer hides a listFacts-only adapter", "src/knowledge/KnowledgeExplorer.tsx", "      {adapter.facts || adapter.listFacts ? (", "      {adapter.facts ? ("],
  ["collapsed timeline hides failures", "src/activity.tsx", "{!open && failedTools.length > 0 ? (", "{false ? ("],
  ["collapsed timeline shows every row", "src/activity.tsx", "  const failedTools = tools.filter((t) => t.outcome === \"failure\");", "  const failedTools = tools;"],
  ["retry posts the wrong route", "src/transport.ts", "`${thread}/turns/${encodeURIComponent(turnId)}/retry`", "`${thread}/retry`"],
  ["retry not exposed", "src/useAgentThread.ts", "return retryTurn ? tracked(() => retryTurn(turnId)) : Promise.reject(", "return false ? tracked(() => retryTurn(turnId)) : Promise.reject("],
  ["AgentThread ignores chat.retry", "src/AgentThread.tsx", "const retryTurn = onRetryTurn ?? (chatRetry ? (turnId: string) => void chatRetry(turnId) : undefined);", "const retryTurn = onRetryTurn;"],
  ["chat.retry overrides onRetryTurn", "src/AgentThread.tsx", "const retryTurn = onRetryTurn ?? (chatRetry ? (turnId: string) => void chatRetry(turnId) : undefined);", "const retryTurn = (chatRetry ? (turnId: string) => void chatRetry(turnId) : undefined) ?? onRetryTurn;"],
  ["interval polls hold the worker", "src/transport.ts", "const r = await poll(h.after(), 0, abort.signal);", "const r = await poll(h.after(), pollWaitMs, abort.signal);"],
  ["interval polls while idle", "src/transport.ts", "delay = running || graceLeft ? gap : waitLeft > 0 ? Math.min(gap, waitLeft) : idleMs;", "delay = gap;"],
  ["interval has no grace after an action", "src/transport.ts", "const graceLeft = Date.now() + gap - wokeAt <= graceMs;", "const graceLeft = false;"],
  ["interval never backs off on errors", "src/transport.ts", "delay = Math.min(maxBackoffMs, activeMs * 2 ** errors);", "delay = activeMs;"],
  ["interval error back-off uncapped", "src/transport.ts", "delay = Math.min(maxBackoffMs, activeMs * 2 ** errors);", "delay = activeMs * 2 ** errors;"],
  ["interval never backs off when empty", "src/transport.ts", "gap = Math.min(maxActiveMs, gap * emptyBackoff);", "gap = activeMs;"],
  ["interval polls a hidden tab", "src/transport.ts", "const isHidden = () => pauseWhenHidden && doc?.visibilityState === \"hidden\";", "const isHidden = () => false;"],
  ["interval does not catch up when shown", "src/transport.ts", "        paused = false;\n        schedule(0);", "        paused = false;"],
  ["actions do not wake interval mode", "src/transport.ts", "    for (const w of [...wakers]) w();\n", ""],
  ["a parked turn counts as active", "src/store.ts", "active: () => state.turns.some((t) => t.state === \"pending\" || t.state === \"running\" || t.state === \"cancelling\"),", "active: () => state.turns.some((t) => t.state !== \"settled\"),"],
  ["interval stops before late quick replies", "src/transport.ts", "delay = running || graceLeft ? gap : waitLeft > 0 ? Math.min(gap, waitLeft) : idleMs;", "delay = running || graceLeft ? gap : idleMs;"],
  ["quick-reply window unbounded", "src/transport.ts", "const waitLeft = due === null ? 0 : due + suggestionsMs - Date.now();", "const waitLeft = due === null ? 0 : 1;"],
  ["quick-reply window skips its bound", "src/transport.ts", "waitLeft > 0 ? Math.min(gap, waitLeft) : idleMs;", "waitLeft > 0 ? gap : idleMs;"],
  ["quick-reply window off by default", "src/transport.ts", "const suggestionsMs = Math.max(0, iv.suggestionsMs ?? 15000);", "const suggestionsMs = Math.max(0, iv.suggestionsMs ?? 0);"],
  ["quick-reply window ignores suggestionsMs", "src/transport.ts", "const suggestionsMs = Math.max(0, iv.suggestionsMs ?? 15000);", "const suggestionsMs = 15000;"],
  ["history settle opens the window", "src/store.ts", "onEvents: (events) => ingest(events, answers <= 1),", "onEvents: (events) => ingest(events, false),"],
  ["suggestions.updated does not end the window", "src/store.ts", "if (suggestionsDue && suggestionsDue.turnId === turnId) suggestionsDue = null;", "void 0;"],
  ["window after a failed turn", "src/store.ts", "newest.state !== \"settled\" || newest.outcome !== \"completed\") return;", "newest.state !== \"settled\") return;"],
  ["Stop shown when the backend cannot cancel", "src/AgentComposer.tsx", "onStop={canStop ? onStop : undefined}", "onStop={onStop}"],
  ["capabilities never read", "src/useAgentThread.ts", "    if (!transport.capabilities) return;\n", "    return;\n"],
  ["capabilities from a failed shape", "src/useAgentThread.ts", "if (live && c && typeof c.cancel === \"boolean\") setCapabilities(c);", "if (live) setCapabilities(c);"],
  ["inexact duration shown as exact", "src/activity.tsx", "{entry.durationExact === false ? labels.durationAtMost(labels.durationMs(entry.durationMs)) : labels.durationMs(entry.durationMs)}", "{labels.durationMs(entry.durationMs)}"],
  ["summary hides an inexact total", "src/activity.tsx", "const exact = tools.every((t) => t.durationMs === null || t.durationExact !== false);", "const exact = true;"],
  ["thinking blocks share a handle", "src/activity.tsx", "<div data-fancy-chat-thinking={entry.thinkingId ?? entry.runId} ", "<div data-fancy-chat-thinking={entry.runId} "],
  ["older tool entries crash", "src/activity.tsx", "const text = full ? full.text : (entry.output ?? null);", "const text = full ? full.text : entry.output;"],
  ["fact version unchecked", "src/knowledge/shapes.ts", "export const readFactListing = (input: unknown) => readListing(input, isFact, \"fact\");", "export const readFactListing = (input: unknown) => (isObj(input) && Array.isArray(input.items) && input.items.every(isFact) ? { ok: true as const, value: input as unknown as KnowledgeListing<KnowledgeFact> } : { ok: false as const, error: \"knowledge.shape\" });"],
  ["unknown fact status accepted", "src/knowledge/shapes.ts", "    FACT_STATUSES.has(v.status) &&\n", ""],
  ["fact evidence unchecked", "src/knowledge/shapes.ts", "    v.evidence.every(str) &&\n", "    true &&\n"],
  ["facts never ask for proposals", "src/knowledge/FactsExplorer.tsx", "() => list(subject, { unaccepted: includeUnaccepted }),", "() => list(subject, { unaccepted: false }),"],
  ["accept offered on any status", "src/knowledge/FactsExplorer.tsx", "{canDecide && f.status === \"proposed\" ? (", "{canDecide ? ("],
  ["accept offered without callbacks", "src/knowledge/FactsExplorer.tsx", "const canDecide = !!onAccept && !!onReject;", "const canDecide = true;"],
  ["fact decision not locked", "src/knowledge/FactsExplorer.tsx", "if (!fn || busyRef.current) return;", "if (!fn) return;"],
  ["facts not reloaded after a decision", "src/knowledge/FactsExplorer.tsx", "      if (alive.current) loadFacts();\n", ""],
  ["failed decision stays locked", "src/knowledge/FactsExplorer.tsx", "      busyRef.current = false;\n      if (alive.current) setBusy(null);", "      if (false) setBusy(null);"],
  ["versions of every predicate", "src/knowledge/FactsExplorer.tsx", ".filter((f) => f.predicate === open.predicate)", ".filter(() => true)"],
  ["evidence not refused on version", "src/knowledge/FactsExplorer.tsx", "void read(() => get([...open.evidence]), readChunkListing,", "void read(() => get([...open.evidence]), (v: unknown) => ({ ok: true as const, value: v as { items: KnowledgeChunk[] } }),"],
  ["graph edges skip evidence", "src/knowledge/graph.ts", "      links.push({ source: node, target: ev });\n", ""],
  ["graph duplicates shared evidence", "src/knowledge/graph.ts", "    if (seen.has(n.id)) return;\n", ""],
  ["graph selects on any click", "src/charts/index.tsx", "if (p?.dataType === \"node\" && typeof p.data?.factId === \"string\") onSelectFact(p.data.factId);", "onSelectFact(String(p?.data?.factId));"],
  ["knowledge explorer hides facts", "src/knowledge/KnowledgeExplorer.tsx", "      {adapter.facts || adapter.listFacts ? (\n        <FactsExplorer", "      {false ? (\n        <FactsExplorer"],
  ["retracted messages shown", "src/AgentThread.tsx", '.filter((r) => !(r.kind === "message" && r.retracted))', ".filter(() => true)"],
  ["jump does not ask to follow", "src/AgentThread.tsx", "onClick={() => onFollowChange(true)}", "onClick={() => onFollowChange(false)}"],
  ["approval not gated by actionable", "src/AgentThread.tsx", "const isApprovalActionable = (approvalId: string) => !!onDecide && actionableId === approvalId;", "const isApprovalActionable = (_approvalId: string) => !!onDecide;"],
  ["composer ignores the thread's draft", "src/AgentComposer.tsx", "const draft = drafts[threadId] ?? EMPTY_PROMPT_DRAFT;", "const draft = EMPTY_PROMPT_DRAFT;"],
  ["stop not wired", "src/AgentComposer.tsx", "onStop={canStop ? onStop : undefined}", "onStop={undefined}"],
  ["decision carries the decision", "src/useAgentThread.ts", "        optionId: input.optionId,\n", "        optionId: input.optionId,\n        decision: input.decision,\n"],
  ["decide drops edited", "src/useAgentThread.ts", "        ...(input.edited !== undefined ? { edited: input.edited } : {}),\n", ""],
  ["protocol-relative image src", "src/PartView.tsx", "const SAME_ORIGIN_PATH = /^\\/(?![\\/\\\\])/;", "const SAME_ORIGIN_PATH = /^\\//;"],
  ["backslash image src", "src/PartView.tsx", "const SAME_ORIGIN_PATH = /^\\/(?![\\/\\\\])/;", "const SAME_ORIGIN_PATH = /^\\/(?!\\/)/;"],
  ["gap never repaired", "src/store.ts", "if (r.missing) void repair(r.missing);", ";"],
  ["old nudges fetch", "src/store.ts", "if (seq > log.lastSeq && running)", "if (running)"],
  ["cancelled turn tail applied", "src/store.ts", "return !!turn && turn.state === \"settled\" && turn.outcome !== null && ABANDONED.has(turn.outcome);", "return false;"],
  ["duplicate batches republish", "src/store.ts", "if (changed || missingChanged) publish(", "if (true) publish("],
  ["sse never falls back", "src/transport.ts", "if (options.mode !== \"sse\" && !delivered && failures >= failuresBeforePoll) {", "if (false) {"],
  ["sse falls back after delivering", "src/transport.ts", "if (options.mode !== \"sse\" && !delivered && failures", "if (options.mode !== \"sse\" && failures"],
  ["resume ignores the cursor", "src/transport.ts", "`${thread}/events?after=${h.after()}${profileQuery}`", "`${thread}/events?after=0${profileQuery}`"],
  ["host headers dropped", "src/transport.ts", "...(options.headers?.() ?? {})", ""],
  ["pill label can close its pill", "src/triggers.ts", 'if (ch === "[" || ch === "]" || ch === "|" || code < 0x20 || code === 0x7f) out += " ";', 'if (code < 0x20) out += " ";'],
  ["duplicate trigger characters", "src/triggers.ts", 'if (byChar.has(definition.char)) throw new TypeError(`The trigger "${definition.char}" is already registered.`);', ";"],
  ["send now offered at once", "src/QueueBar.tsx", "waited >= sendNowAfterMs", "waited >= 0"],
  // Removing ONLY the revert guard is equivalent: the button is disabled at the
  // deadline and React does not dispatch a click on a disabled button. The entry
  // below removes both, which is the real way a late revert could get through.
  ["late undo revert (button enabled too)", "src/UndoCountdown.tsx", 'disabled={!canRevert || busy} onClick={revert}', 'disabled={busy} onClick={() => onRevert?.(entry.actionId)}'],
  ["profile accepts any part kind", "src/profile.ts", "throw new TypeError(`Unknown part kind in profile", "void (`Unknown part kind in profile"],
  ["profile part filter ignored", "src/PartView.tsx", "const allowed = !props.allowedKinds || props.allowedKinds.includes(part.kind);", "const allowed = true;"],
  ["profile hitl kinds ignored", "src/AgentThread.tsx", 'const actionableKinds = actionableKindsProp ?? profile?.hitl?.actionable ?? ["approval", "question"];', 'const actionableKinds = actionableKindsProp ?? ["approval", "question"];'],
  ["superseded branch always shown", "src/AgentThread.tsx", ".filter((r) => showBranches || !branchOf.has(r.id))", ".filter(() => true)"],
  ["branch toggle inverted", "src/AgentThread.tsx", "onClick={() => setShowBranches(!showBranches)}", "onClick={() => setShowBranches(showBranches)}"],
  ["actionable memoised on state identity", "src/AgentThread.tsx", "const actionableId = actionableIn(state, actionableKinds);", "const actionableId = useMemo(() => actionableIn(state, actionableKinds), [state, actionableKinds]);"],
  ["approval lock never released under StrictMode", "src/ApprovalCard.tsx", "    mounted.current = true;\n", ""],
  ["question lock never released under StrictMode", "src/QuestionForm.tsx", "    mounted.current = true;\n", ""],
  ["knowledge loads discarded under StrictMode", "src/knowledge/KnowledgeExplorer.tsx", "    alive.current = true;\n", ""],
  ["facts loads discarded under StrictMode", "src/knowledge/FactsExplorer.tsx", "    alive.current = true;\n", ""],
  ["a throwing event stalls the store", "src/store.ts", "      try {\n        applyEvent(state, event);\n      } catch (error) {", "      try {\n        applyEvent(state, event);\n      } catch (error) {\n        throw error;"],
  ["refusals never warned", "src/store.ts", "    console.warn(\n      `[fancy-chat] refused", "    void (\n      `[fancy-chat] refused"],
  ["every refusal warns", "src/store.ts", "    if (warnedRefusal) return;\n", ""],
  ["error never clears", "src/store.ts", "    if (snapshot.error !== null) publish({ error: null }, false);", "    void 0;"],
  ["transport never reports health", "src/transport.ts", "        h.onHealthy?.();\n", ""],
  ["newer page props ignored", "src/useAgentThread.ts", "if (!initial || !(initial.lastSeq > store.getSnapshot().lastSeq)) return;", "return;"],
  ["poll failures silent", "src/transport.ts", "        console.warn(`[fancy-chat] ${path} failed", "        void (`[fancy-chat] ${path} failed"],
  ["every failure warns, not once per streak", "src/transport.ts", "        if (failing) return;\n", ""],
  ["SSE failure never reported", "src/transport.ts", "          failed(ssePath, new Error(`The event stream ${ssePath} failed`));\n", ""],
  ["typed approval hint ignores the app's opt-in", "src/AgentComposer.tsx", "matchTypedApproval(draft.text, props.typedApproval.approval, props.typedApproval.config)", "matchTypedApproval(draft.text, props.typedApproval.approval, { ...props.typedApproval.config, enabled: true })"],
  ["shared store stops on the first surface", "src/store.ts", "      if (users > 0) return;\n", ""],
  ["profile not sent on streams", "src/transport.ts", "`${thread}/events?after=${h.after()}${profileQuery}`", "`${thread}/events?after=${h.after()}`"],
  ["decided shown as delivered", "src/labels.ts", '    decided: "Taken as your decision",\n', '    decided: "Delivered",\n'],
  ["quadratic trailing-slash regex back", "src/transport.ts", "const base = trimTrailingSlashes(options.baseUrl);", "const base = options.baseUrl.replace(/\\/+$/, \"\");"],
  // ./knowledge
  ["any contract version accepted", "src/knowledge/shapes.ts", "if (v.contractVersion === expected) return null;", "return null;"],
  ["provenance unchecked", "src/knowledge/shapes.ts", "    int(v.position) &&\n    isProvenance(v.provenance) &&\n", "    int(v.position) &&\n"],
  ["any job state accepted", "src/knowledge/shapes.ts", "STATES.has(input.state) &&", ""],
  ["zero stale window accepted", "src/knowledge/shapes.ts", "int(input.staleAfterMs, 1)", "int(input.staleAfterMs, 0)"],
  ["queued/running shown before jobs land", "src/knowledge/ingest.ts", "if (!options.jobsAvailable) return { display: \"unknown\", alarm: false };", ";"],
  ["stored state trusted over a stale heartbeat", "src/knowledge/ingest.ts", "const fresh = worker !== null && Number.isFinite(beat) && now - beat <= worker.staleAfterMs;", "const fresh = true;"],
  ["stale window off by one", "src/knowledge/ingest.ts", "now - beat <= worker.staleAfterMs", "now - beat < worker.staleAfterMs"],
  ["no nothing-processing alarm", "src/knowledge/ingest.ts", "return { display: \"unknown\", alarm: true };", "return { display: \"unknown\", alarm: false };"],
  ["search hits rendered as HTML", "src/knowledge/KnowledgeExplorer.tsx", "<Text className=\"whitespace-pre-wrap break-words\">{h.text}</Text>", "<div dangerouslySetInnerHTML={{ __html: h.text }} />"],
  ["load more ignores the cursor", "src/knowledge/KnowledgeExplorer.tsx", "onClick={() => loadSources(sourcesCursor)}", "onClick={() => loadSources(null)}"],
  ["sources shown without listSources", "src/knowledge/KnowledgeExplorer.tsx", "{adapter.listSources ? (\n        <section", "{true ? (\n        <section"],
  ["refused listing still rendered", "src/knowledge/KnowledgeExplorer.tsx", "{!sourcesError ? (\n            <Table>", "{true ? (\n            <Table>"],
  ["renders without an adapter", "src/knowledge/KnowledgeExplorer.tsx", "if (!adapter) return null;", "if (!adapter) return <div data-fancy-chat-knowledge=\"\" />;"],
  // ./charts
  ["raw options allowed by default", "src/charts/index.tsx", "const { allowRawOptions = false,", "const { allowRawOptions = true,"],
  ["invalid spec handed to ECharts", "src/charts/index.tsx", "if (!verdict.ok) return fallback(\"invalid\");", ";"],
  ["height ignored", "src/charts/index.tsx", "style={{ width: \"100%\", height }}", "style={{ width: \"100%\", height: 280 }}"],
  ["unknown spec keys leak into the option", "src/charts/spec.ts", "return { type: spec.type, ...named(s), data };", "return { type: spec.type, ...s, data };"],
  ["area loses its fill", "src/charts/spec.ts", "return { type: \"line\", areaStyle: {}, ...named(s), data };", "return { type: \"line\", ...named(s), data };"],
  ["pie slices unnamed", "src/charts/spec.ts", "(categories?.[i] !== undefined ? { name: categories[i], value: v } : v)", "v"],
  ["legend on a single series", "src/charts/spec.ts", "if (series.length > 1 && names.length)", "if (names.length)"],
  // entry isolation, read from the build's metafile
  ["root entry pulls in ./charts", "src/index.ts", "export { actionableIn } from \"./actionable\";", "export { actionableIn } from \"./actionable\";\nexport { chartPartRenderer } from \"./charts/index\";"],
  // 0.2.0: attachments, CC-fancy-0044, prism-graph types only
  ["attachments not passed through", "src/AgentComposer.tsx", "        attachments={attachments}\n", ""],
  ["attachments off by default", "src/AgentComposer.tsx", "aboveInput, attachments = true, disabled", "aboveInput, attachments = false, disabled"],
  ["valid-from unformatted", "src/knowledge/FactsExplorer.tsx", "<Table.Cell>{formatDate(f.validFrom)}</Table.Cell>", "<Table.Cell>{f.validFrom}</Table.Cell>"],
  ["validRange unformatted", "src/knowledge/FactsExplorer.tsx", "labels.validRange(formatDate(v.validFrom), v.validTo ? formatDate(v.validTo) : null)", "labels.validRange(v.validFrom, v.validTo ?? null)"],
  ["host formatter ignored", "src/knowledge/FactsExplorer.tsx", "formatDate = defaultFormatDate, evidenceLabel", "formatDate: _formatDate, evidenceLabel"],
  ["a lenient date is guessed", "src/knowledge/format.ts","const t = ISO_8601.test(iso) ? Date.parse(iso) : Number.NaN;", "const t = Date.parse(iso);"],
  ["host evidence label ignored", "src/knowledge/FactsExplorer.tsx", "evidenceLabel = defaultEvidenceLabel } = props;", "evidenceLabel: _evidenceLabel } = props;\n  const evidenceLabel = defaultEvidenceLabel;"],
  ["source title not shown", "src/knowledge/FactsExplorer.tsx", "  return [title, p.headingPath.join(\" / \")", "  return [p.headingPath.join(\" / \")"],
  ["title URI repeated", "src/knowledge/FactsExplorer.tsx", "p.uri === title ? \"\" : p.uri", "p.uri"],
  ["sourceTitle of any type", "src/knowledge/shapes.ts", "(v.sourceTitle === undefined || str(v.sourceTitle)) &&", ""],
  ["prism-graph imported at runtime", "src/knowledge/shapes.ts", "import type { Fact, FactStatus as PrismFactStatus, ListedChunk, ListedSource, ListingPage } from \"@particle-academy/prism-graph\";", "import type { Fact, FactStatus as PrismFactStatus, ListedChunk, ListedSource, ListingPage } from \"@particle-academy/prism-graph\";\nimport { isTrust as _isTrust } from \"@particle-academy/prism-graph\";\nexport const __trust = _isTrust;"],
  // Quick replies (CC-fancy-0065)
  ["chips while a turn runs", "src/QuickReplies.tsx", 'if (state.turns.some((t) => t.state !== "settled")) return true;', ";"],
  ["chips over a pending approval", "src/QuickReplies.tsx", 'if (state.approvals.some((a) => a.state === "pending" || a.state === "deciding")) return true;', ";"],
  ["chips over an open question", "src/QuickReplies.tsx", 'if (state.questions.some((q) => (q.state ?? "open") === "open")) return true;', ";"],
  ["host cannot hide chips", "src/QuickReplies.tsx", "if (options.hidden) return true;", ";"],
  ["chips after the human wrote", "src/QuickReplies.tsx", 'return !last || last.author?.kind === "human";', "return false;"],
  ["chips without onSuggest", "src/AgentThread.tsx", "{onSuggest && suggestions && suggestions.length > 0 &&", "{suggestions && suggestions.length > 0 &&"],
  ["chip group label hardcoded", "src/QuickReplies.tsx", "aria-label={labels.quickReplies}", 'aria-label="Suggested replies"'],
  ["a pick carries more than the suggestion", "src/QuickReplies.tsx", "onClick={() => onSuggest({ id: s.id, text: s.text })}", "onClick={() => onSuggest({ ...s, decision: \"approve\" } as QuickReply)}"],
  ["arrow keys ignored", "src/QuickReplies.tsx", "chips[next]?.focus();", ";"],
  ["a stale turn's suggestions read", "src/QuickReplies.tsx", "newest.turnId !== turnId || ", ""],
  ["malformed suggestion items kept", "src/QuickReplies.tsx", 'typeof item.id === "string" && item.id !== "" && ', ""],
  ["a sent suggestion carries a tool part", "src/QuickReplies.tsx", 'return { parts: [{ id: "p1", kind: "text", format: "plain", text: suggestion.text }] };', 'return { parts: [{ id: "p1", kind: "text", format: "plain", text: suggestion.text }, { id: "p2", kind: "tool-call", name: suggestion.text }] };'],
  ["sendSuggestion decides", "src/useAgentThread.ts", "transport.send(suggestionMessage(suggestion))", "transport.decide(suggestion.id, { optionId: suggestion.id })"],
  // The send outcome follows the projection (Tynn #259)
  ["outcome stuck on the send response", "src/sendOutcome.ts", "const delivery = projected !== null && !BEHIND_THE_RESPONSE.has(projected) ? projected : sent.delivery;", "const delivery = sent.delivery;"],
  ["a projection behind the response wins", "src/sendOutcome.ts", "projected !== null && !BEHIND_THE_RESPONSE.has(projected) ?", "projected !== null ?"],
  ["delivered still shown", "src/sendOutcome.ts", 'const NOTHING_TO_SAY = new Set(["sent", "delivered"]);', 'const NOTHING_TO_SAY = new Set(["sent"]);'],
  ["outcome never cleared", "src/sendOutcome.ts", "if (NOTHING_TO_SAY.has(delivery)) return null;", ";"],
  ["a moved-on outcome keeps the old reason", "src/sendOutcome.ts", "return { ...(sent.messageId ? { messageId: sent.messageId } : {}), delivery };", "return { ...sent, delivery };"],
  ["send response's messageId dropped", "src/useAgentThread.ts", "outcome: { messageId: r.messageId, delivery: r.delivery }", "outcome: { delivery: r.delivery }"],
  ["a late older send overwrites a newer one", "src/useAgentThread.ts", "if (mine()) setSent({ transport, outcome: { messageId", "if (true) setSent({ transport, outcome: { messageId"],
  ["a failed send not shown", "src/useAgentThread.ts", 'if (mine()) setSent({ transport, outcome: { delivery: "failed"', 'if (false) setSent({ transport, outcome: { delivery: "failed"'],
  ["previous line kept while sending", "src/useAgentThread.ts", "      setSent(null);\n", ""],
  ["outcome survives a thread switch", "src/useAgentThread.ts", "sent && sent.transport === transport ?", "sent ?"],
  ["send untracked", "src/useAgentThread.ts", "(input: SendInput) => tracked(() => transport.send(input))", "(input: SendInput) => transport.send(input)"],
  ["sendSuggestion untracked", "src/useAgentThread.ts", "tracked(() => transport.send(suggestionMessage(suggestion)))", "transport.send(suggestionMessage(suggestion))"],
  ["retry untracked", "src/useAgentThread.ts", "retryTurn ? tracked(() => retryTurn(turnId))", "retryTurn ? retryTurn(turnId)"],
  ["capabilities reset in an effect (loops an inline transport)", "src/useAgentThread.ts", "  useEffect(() => {\n    if (!transport.capabilities) return;", "  useEffect(() => {\n    setLoadedCapabilities(null);\n    if (!transport.capabilities) return;"],
  ["stale capabilities on a new transport", "src/useAgentThread.ts", "loadedCapabilities && loadedCapabilities.transport === transport ?", "loadedCapabilities ?"],
  ["outcome not re-derived on new events", "src/useAgentThread.ts", "[sent, transport, snapshot.version], // eslint-disable-line", "[sent, transport], // eslint-disable-line"],
];

function runSuite() {
  // `npm test` builds first (pretest), so the metafile-based entry checks see
  // the mutated build rather than a stale one.
  const r = spawnSync("npm", ["test", "--silent"], { cwd: root, shell: true, encoding: "utf8" });
  return r.status;
}

let survived = 0;
let missing = 0;
for (const [name, rel, search, replace] of MUTATIONS) {
  const path = file(rel);
  const original = readFileSync(path, "utf8");
  const normalized = original.split("\r\n").join("\n");
  if (!normalized.includes(search)) {
    console.log(`MISSING  ${name}: pattern not found in ${rel}`);
    missing += 1;
    continue;
  }
  try {
    writeFileSync(path, normalized.replace(search, replace));
    if (runSuite() === 0) {
      console.log(`SURVIVED ${name}`);
      survived += 1;
    } else {
      console.log(`caught   ${name}`);
    }
  } finally {
    writeFileSync(path, original);
  }
}
console.log(`sabotage: ${MUTATIONS.length} mutations, ${MUTATIONS.length - survived - missing} caught, ${survived} survived, ${missing} missing`);
process.exit(missing ? 2 : survived ? 1 : 0);
