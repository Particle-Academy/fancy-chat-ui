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
  ["retracted messages shown", "src/AgentThread.tsx", '.filter((r) => !(r.kind === "message" && r.retracted))', ".filter(() => true)"],
  ["jump does not ask to follow", "src/AgentThread.tsx", "onClick={() => onFollowChange(true)}", "onClick={() => onFollowChange(false)}"],
  ["approval not gated by actionable", "src/AgentThread.tsx", "actionable={!!onDecide && actionableId === approvalId}", "actionable={!!onDecide}"],
  ["composer ignores the thread's draft", "src/AgentComposer.tsx", "const draft = drafts[threadId] ?? EMPTY_PROMPT_DRAFT;", "const draft = EMPTY_PROMPT_DRAFT;"],
  ["stop not wired", "src/AgentComposer.tsx", "onStop={onStop}", "onStop={undefined}"],
  ["decision carries the decision", "src/useAgentThread.ts", "transport.decide(input.approvalId, { optionId: input.optionId,", "transport.decide(input.approvalId, { optionId: input.optionId, decision: input.decision,"],
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
  ["typed approval hint ignores the app's opt-in", "src/AgentComposer.tsx", "matchTypedApproval(draft.text, props.typedApproval.approval, props.typedApproval.config)", "matchTypedApproval(draft.text, props.typedApproval.approval, { ...props.typedApproval.config, enabled: true })"],
  ["shared store stops on the first surface", "src/store.ts", "      if (users > 0) return;\n", ""],
  ["profile not sent on streams", "src/transport.ts", "`${thread}/events?after=${h.after()}${profileQuery}`", "`${thread}/events?after=${h.after()}`"],
  ["quadratic trailing-slash regex back", "src/transport.ts", "const base = trimTrailingSlashes(options.baseUrl);", "const base = options.baseUrl.replace(/\\/+$/, \"\");"],
  // ./knowledge
  ["any contract version accepted", "src/knowledge/shapes.ts", "if (v.contractVersion === G282_VERSION) return null;", "return null;"],
  ["provenance unchecked", "src/knowledge/shapes.ts", "int(v.position) && isProvenance(v.provenance)", "int(v.position)"],
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
