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
  ["retracted messages shown", "src/AgentThread.tsx", 'rows.filter((r) => !(r.kind === "message" && r.retracted))', "rows.filter(() => true)"],
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
  ["resume ignores the cursor", "src/transport.ts", "`${thread}/events?after=${h.after()}`", "`${thread}/events?after=0`"],
  ["host headers dropped", "src/transport.ts", "...(options.headers?.() ?? {})", ""],
];

function runSuite() {
  const r = spawnSync("npx", ["vitest", "run", "--reporter=dot"], { cwd: root, shell: true, encoding: "utf8" });
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
