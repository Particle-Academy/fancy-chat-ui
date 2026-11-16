# @particle-academy/fancy-chat-ui

React surfaces for the Fancy agent chat framework (council change CC-fancy-0042),
composed from react-fancy. It renders the neutral contract in
`@particle-academy/fancy-chat-js` and talks to any server that speaks it, such as
`particle-academy/fancy-chat-php`. It is **provider-neutral**: no Prism import, and a
packaging test enforces that. Prism adapters are optional, in
`@particle-academy/fancy-chat-prism`.

**Not yet published.** Install from git (see Install). Phases P1 and P2 of
`.ai/plans/agent-chat-framework.md` are built; the Prism adapters are separate
packages.

## What it holds

| Export | On | What |
|---|---|---|
| `createHttpTransport` | `fetch`, `EventSource` | SSE resuming after the last seq, falling back to long-poll when SSE fails before delivering anything (the fancy-cf-relay strategy). `mode: "interval"` for a host that cannot hold a request open (see Transport modes). Decisions carry no actor. |
| `createThreadStore` / `useAgentThread` | fancy-chat-js | Seq dedupe, gap repair (`after = lastSeq`), the shared reducer and projection. An optional Echo/Reverb `nudge` only triggers a fetch, so a missed broadcast costs nothing. The hook also returns `capabilities` (the backend's `cancel`, `steering`, `approvals`, or null) and `decide({ approvalId, optionId, note?, edited? })`. |
| `AgentThread` | `VirtualList`, `ChatMessage` | One windowing and follow model: virtualised `role="log"`, controlled `follow` that a reader's scroll breaks, Jump to latest, deep link, Load earlier with prepend anchoring. Typed parts render in ChatMessage's `body`. |
| `AgentComposer` | `PromptInput` | Controlled per-thread drafts (one composer for N threads via `draftKey`), Stop while running (hidden with `canStop={false}` when the backend cannot cancel; the composer still shows the turn running), and a send-outcome line that keeps the draft on failure. |
| `PartView` | `ContentRenderer`, `CodeBlock`, `Table`, `Card` | Every core part kind; app kinds through `renderers`; an unknown kind renders its text, never dropped. Links only to http(s). |
| `ThinkingBlock`, `ToolRow`, `PlanRow` | `Badge`, `Progress`, `CodeBlock` | Thinking blocks (several per run, in order, each with its own `data-fancy-chat-thinking` id); tool rows, with a bounded duration shown as "≤ 1.2 s" (`durationExact: false`) with failure (red) and refusal (neutral) styled apart, Retry on failure only, and the tool's **output inline** (see below). |
| `ActivityTimeline` | `Timeline` | A run's thinking and tool calls as one timeline: expanded while running, collapsed to "3 tool calls · 4.2 s · 1 failed" once settled. Collapsed, each FAILED tool's row stays visible with its failure text. `AgentThread activity="timeline"` uses it. |
| `ModelError` | `Badge`, `Button` | A turn the model could not finish: its reason and Retry. A refusal shows neutral, with no Retry. `AgentThread` shows it for the newest turn; Retry calls `onRetryTurn`, or by default `chat.retry` (pass the hook as `chat`). |
| `ApprovalCard` | `Card`, `Button`, `Textarea` | Tone and decision from the option KIND, never its label; note; in-flight lock; one actionable at a time. |
| `QuestionForm` | `RadioGroup`, `CheckboxGroup`, `Textarea` | Controlled drafts; Answer enabled once each required field has an option or a note. |

Phase 2 adds `QueueBar`, `UndoCountdown`, the trigger registry (`createTriggerRegistry`,
`serializePill`) on PromptInput `triggers`, surface profiles (`defineSurfaceProfile`,
one shared store across surfaces), edit-and-resend branches, held-step links and the
typed-approval warning. `npm run test:e2e` drives the real transport against
fancy-chat-php.

Every component is controlled, carries `data-fancy-chat-*` handles, and takes
`labels`. A co-driving agent reaches the surface through
`registerAgentChatBridge` in `@particle-academy/agent-integrations` (`./bridges/agent-chat`),
which has **no** decide, answer or send tool.

## Install

Until the first npm publish, install from git, over **HTTPS**, pinned to a commit:

```bash
npm install "git+https://github.com/Particle-Academy/react-fancy.git#<sha>" "git+https://github.com/Particle-Academy/fancy-chat-js.git#<sha>" "git+https://github.com/Particle-Academy/fancy-chat-ui.git#<sha>"
```

- **Each package builds its `dist` in `prepare`.** npm runs `prepare` for a git
  dependency, so the install compiles them. **With `ignore-scripts=true`** (in `.npmrc`
  or the environment) npm skips `prepare` and the package arrives with no `dist`,
  so a bundler later reports an unresolvable entry. A postinstall check cannot catch
  this, because `ignore-scripts` skips postinstall too. Run
  `npx fancy-chat-check-install` after installing (and in CI): it exits 1 and names
  every `@particle-academy` package whose entry files are missing, with the cause.
  It is a committed script in fancy-chat-js, so it works without any build. To fix,
  allow scripts for the install, or build the three in order (react-fancy,
  fancy-chat-js, fancy-chat-ui) with `npm run build` inside each
  `node_modules/@particle-academy/<pkg>`.
- **npm writes `git+ssh://git@github.com/...` into `package-lock.json`** for a GitHub
  dependency even when you installed it over HTTPS. A machine with no GitHub SSH key
  (a CI runner) still installs: npm falls back to HTTPS for a public GitHub repo. If
  your CI forbids SSH outright, rewrite the lockfile's `resolved` entries to
  `git+https://github.com/...` (same sha); `npm ci` accepts either.
- react-fancy's git pin carries a plain version (`6.27.0`, no prerelease tag), so it
  satisfies sibling peers such as `>=5.41.0 <7`. This package peers on
  `@particle-academy/react-fancy >=6.27.0 <7`.

## Use

```tsx
import { AgentComposer, AgentThread, createHttpTransport, useAgentThread } from "@particle-academy/fancy-chat-ui";

const transport = useMemo(() => createHttpTransport({ baseUrl: "/fancy-chat", threadId }), [threadId]);
const chat = useAgentThread({ transport });
const [follow, setFollow] = useState(true);

<AgentThread rows={chat.rows} state={chat.state} follow={follow} onFollowChange={setFollow} onDecide={chat.decide} onAnswer={chat.answer} chat={chat} />
<AgentComposer threadId={threadId} drafts={drafts} onDraftsChange={setDrafts} running={!!chat.activeTurn}
  onStop={() => chat.cancel("stop")} canStop={chat.capabilities?.cancel !== false}
  onSend={({ text }) => chat.send({ parts: [{ id: "p1", kind: "text", format: "plain", text }] })} />
```

## The server routes (fancy-chat-php, or your own)

| Route | Answers |
|---|---|
| `POST threads/{id}/messages` | **201** `{ messageId, seq, delivery }` (`delivery` is `sent`, `queued`, or `decided` for a typed decision, which also carries `typedDecision`) |
| `GET threads/{id}/events?after=` | SSE, resuming after `after` (or `Last-Event-ID`) |
| `GET threads/{id}/events/poll?after=&wait=` | 200 `{ events, next }`; `wait` is milliseconds, `0` answers at once |
| `GET threads/{id}/snapshot?at=` | 200 `{ snapshot, seq, capabilities }`: `snapshot` is the projected state (fancy-chat-js `ThreadState`) at `at` (default now), `seq` its `lastSeq` |
| `GET threads/{id}/capabilities` | 200 `{ capabilities: { cancel, steering, approvals } }` |
| `POST threads/{id}/turns/{turnId}/retry` | **201** `{ messageId, seq, delivery }`: re-sends a failed, interrupted or cancelled turn's ORIGINAL message parts as a new turn (`queued` behind a running one). Human actors with `write` access only. The server finds the input through the turn's `messageId`, so it works after a reload. |
| `POST threads/{id}/cancel` | 200 `{ outcome }` |
| `DELETE threads/{id}/queue/{messageId}` | 200 `{ ok }` |
| `POST approvals/{id}/decision` | body `{ optionId, note?, edited? }`; the server resolves the actor |
| `POST questions/{id}/answer`, `POST undo/{id}/revert` | human actors only |

## Transport modes

- **`auto`** (default): SSE, falling back to long-poll after `sseFailuresBeforePoll`
  failures before any event.
- **`poll`**: long-poll, held for `pollWaitMs`.
- **`interval`**: for a host that cannot hold a request open, such as one PHP worker
  (`php artisan serve`, a small FPM pool), where a held SSE stream or long-poll
  blocks every other request. It sends short polls (`wait=0`):
  - only while a turn is pending, running or cancelling, plus `graceMs` (4000) after
    any action you take through the transport (send, decide, answer, cancel, unsend,
    revert), which also polls at once;
  - every `activeMs` (1500) after a poll that brought events, growing by
    `emptyBackoff` (1.5) per empty answer up to `maxActiveMs` (10000);
  - after an error, doubling from `activeMs` up to `maxBackoffMs` (30000);
  - not at all while idle, unless you set `idleMs`;
  - paused while the tab is hidden, catching up the moment it is shown
    (`pauseWhenHidden`, default true).

```ts
createHttpTransport({ baseUrl: "/fancy-chat", threadId, mode: "interval", interval: { activeMs: 1000, idleMs: 30000 } });
```

A parked turn (waiting on a human) does not count as running: the human's action wakes
the transport. The connection state reads `idle` or `paused` while it is not polling.

## Optional entries

The root entry never imports either of these, and a build test reading the
metafile proves it, so a host that uses neither pays for neither.

### `@particle-academy/fancy-chat-ui/charts`

```tsx
import { chartPartRenderer } from "@particle-academy/fancy-chat-ui/charts";

<AgentThread {...props} partViewProps={{ renderers: { chart: chartPartRenderer() } }} />
```

The `chart` part's neutral spec (`line`, `bar`, `area`, `pie`, `scatter`) becomes an
ECharts option rendered by `@particle-academy/fancy-echarts`, an optional peer that
only this entry imports. Only keys the spec names reach ECharts. Raw `part.echarts`
options render only with `chartPartRenderer({ allowRawOptions: true })`, for a host
whose server places them from trusted code. Without that flag they show the part's
plain text. A spec the contract rejects falls back to text too.

### `@particle-academy/fancy-chat-ui/knowledge`

```tsx
import { KnowledgeExplorer } from "@particle-academy/fancy-chat-ui/knowledge";

<KnowledgeExplorer adapter={knowledgeAdapter} />
```

It renders only when an adapter is passed, and each method the adapter lacks hides
its part. The adapter covers `search`, `listSources`, `listChunks`, `ingestJobs`,
`workerStatus`, and for facts `facts`, `factTimeline` and `getChunks`.

- **Scope:** the adapter binds it. There is no scope prop, and a user never picks one.
- **Shapes:** the g282.1 shapes agreed with Prism. Every listing, ingest job and worker
  status must carry `contractVersion: "g282.1"`. Any other value, or none, is refused:
  the explorer names the version that arrived and shows none of that data.
- **Ingest:** until Prism's ingest jobs land, only `done` and `failed` are shown, and
  everything else is `unknown`. Pass `jobsAvailable` once they exist. Even then, `queued`
  and `running` show only while the worker's heartbeat is fresh; a stale or missing one
  shows `unknown` and a red "nothing is processing" banner. `unknown` is never shown as
  running. The rule is `deriveIngestDisplay`.
- **Text:** all text from the store renders as plain text.

#### Facts (prism-graph 0.3)

With an adapter that has `facts`, the explorer adds `FactsExplorer` (also exported on
its own):

```tsx
import { FactsExplorer } from "@particle-academy/fancy-chat-ui/knowledge";
import { FactGraph } from "@particle-academy/fancy-chat-ui/charts";

<FactsExplorer adapter={knowledgeAdapter} subject="acme" graph={FactGraph}
  onAccept={(fact) => post(`/facts/${fact.id}/accept`)}
  onReject={(fact) => post(`/facts/${fact.id}/reject`)} />
```

- **Adapter methods** (each optional): `facts(subject, { unaccepted })` (ScopedGraph
  `facts`), `factTimeline(subject)` (`timeline`), `getChunks(ids)` (`get`). Each
  returns a g282.1 listing (`{ contractVersion: "g282.1", items, nextCursor }`) of
  prism-graph `Fact`s or chunks; any other version is refused and named.
- **The list:** predicate, value, status (Accepted, Proposal, Belief) and valid-from.
  Proposals and beliefs are asked for by default (`includeUnaccepted`).
- **The drawer:** the fact, its evidence passages with provenance, and the version
  timeline of that predicate (oldest first, current marked).
- **The map:** `FactGraph` (`./charts`, on fancy-echarts' graph series): subjects,
  facts and evidence as nodes, edges subject to fact and fact to evidence. Clicking a
  fact opens it. `factGraphOption` (in `./knowledge`, no ECharts import) builds the
  option if you draw it yourself.
- **Accept and Reject are HUMAN-only.** They are callbacks to the host, never adapter
  methods, so nothing that holds the adapter (a co-driving agent included) can decide.
  They show on proposals only, and only when both are passed; a decision locks the
  buttons until it settles, then the list reloads. Post them to an endpoint that
  resolves the human actor itself.
- Subject and open fact are controllable (`subject`/`onSubjectChange`,
  `openFactId`/`onOpenFactChange`). On `KnowledgeExplorer`: `factSubject`,
  `onAcceptFact`, `onRejectFact`, `factGraph`.

## Tool output, inline

A `tool.result` event may carry `output` (the result text, or a failure's own words)
and `outputLanguage`. The projection keeps both on the tool's `ToolEntry`, and
`ToolRow` shows them, so the host does not build an output store:

- **A failure's text shows without expanding** (red); an ok result's output shows
  when the row is expanded.
- **Always text or code, never HTML.** A string renders as escaped text; with
  `outputLanguage` (e.g. `"json"`) it renders in a code block.
- **Bounded twice.** The server cuts `output` (fancy-chat-php
  `limits.tool_output_chars`, default 16384) and sets `truncated`; the row shows at
  most `maxOutputChars` (default 4000) and says when it is shortened.
- **The rest, lazily.** `resolveOutput(ref, entry)` is called once, only when a row
  with an `outputRef` is expanded. Return a string (plain text) or
  `{ text, language? }`, or a promise of either. A rejection shows "could not be
  loaded" in the row.
- **The host's own view.** `renderOutput(entry)` renders anything the host likes
  below the expanded row.

On `AgentThread` these are `resolveToolOutput`, `renderToolOutput` and
`maxToolOutputChars`, passed to every tool row in both `activity="rows"` and
`activity="timeline"`.

```tsx
<AgentThread {...props}
  resolveToolOutput={(ref) => fetch(`/tool-output/${ref}`).then((r) => r.text())}
  renderToolOutput={(entry) => entry.name === "search_deals" ? <DealsPreview callId={entry.toolCallId} /> : null}
  activity="timeline"
  onRetryTurn={(turnId) => retry(turnId)} />
```

## Develop

Until the first publish, the dev dependencies are git commits over HTTPS (see
Install). Re-pin by editing the sha and running `npm install`. To try an unpushed
sibling, `npm install --no-save --install-links ../<repo>`.

```bash
npm install
npm test          # vitest + jsdom, driven by stable handles
npm run lint      # tsc --noEmit && eslint
npm run sabotage  # breaks one clause at a time; the suite must notice each
```

MIT licence.
