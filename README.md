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
