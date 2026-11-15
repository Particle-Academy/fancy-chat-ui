# @particle-academy/fancy-chat-ui

React surfaces for the Fancy agent chat framework (council change CC-fancy-0042),
composed from react-fancy. It renders the neutral contract in
`@particle-academy/fancy-chat-js` and talks to any server that speaks it, such as
`particle-academy/fancy-chat-php`. It is **provider-neutral**: no Prism import, and a
packaging test enforces that. Prism adapters are optional, in
`@particle-academy/fancy-chat-prism`.

**Not yet published.** Status: phase P1 of `.ai/plans/agent-chat-framework.md`.

## What it holds

| Export | On | What |
|---|---|---|
| `createHttpTransport` | `fetch`, `EventSource` | SSE resuming after the last seq, falling back to long-poll when SSE fails before delivering anything (the fancy-cf-relay strategy). Decisions carry no actor. |
| `createThreadStore` / `useAgentThread` | fancy-chat-js | Seq dedupe, gap repair (`after = lastSeq`), the shared reducer and projection. An optional Echo/Reverb `nudge` only triggers a fetch, so a missed broadcast costs nothing. |
| `AgentThread` | `VirtualList`, `ChatMessage` | One windowing and follow model: virtualised `role="log"`, controlled `follow` that a reader's scroll breaks, Jump to latest, deep link, Load earlier with prepend anchoring. Typed parts render in ChatMessage's `body`. |
| `AgentComposer` | `PromptInput` | Controlled per-thread drafts (one composer for N threads via `draftKey`), Stop while running, and a send-outcome line that keeps the draft on failure. |
| `PartView` | `ContentRenderer`, `CodeBlock`, `Table`, `Card` | Every core part kind; app kinds through `renderers`; an unknown kind renders its text, never dropped. Links only to http(s). |
| `ThinkingBlock`, `ToolRow`, `PlanRow` | `Badge`, `Progress`, `CodeBlock` | One thinking block per run; tool rows with failure (red) and refusal (neutral) styled apart, Retry on failure only. |
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

## Use

```tsx
import { AgentComposer, AgentThread, createHttpTransport, useAgentThread } from "@particle-academy/fancy-chat-ui";

const transport = useMemo(() => createHttpTransport({ baseUrl: "/fancy-chat", threadId }), [threadId]);
const chat = useAgentThread({ transport });
const [follow, setFollow] = useState(true);

<AgentThread rows={chat.rows} state={chat.state} follow={follow} onFollowChange={setFollow} onDecide={chat.decide} onAnswer={chat.answer} />
<AgentComposer threadId={threadId} drafts={drafts} onDraftsChange={setDrafts} running={!!chat.activeTurn}
  onStop={() => chat.cancel("stop")}
  onSend={({ text }) => chat.send({ parts: [{ id: "p1", kind: "text", format: "plain", text }] })} />
```

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
its part. The adapter covers `search`, `listSources`, `listChunks`, `ingestJobs` and
`workerStatus`.

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

## Develop

Until the first publish, the dev dependencies point at the sibling checkouts
(`file:../fancy-chat-js`, `file:../react-fancy`, with `install-links` in `.npmrc` so
React is not duplicated). Build both siblings first.

```bash
npm install
npm test          # vitest + jsdom, driven by stable handles
npm run lint      # tsc --noEmit && eslint
npm run sabotage  # breaks one clause at a time; the suite must notice each
```

MIT licence.
