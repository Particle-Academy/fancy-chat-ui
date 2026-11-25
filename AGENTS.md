# Using @particle-academy/fancy-chat-ui — guide for agents

How an agent installs and uses this package in a consumer app. What the package
is, is in [README.md](./README.md). Notes for working ON this repo's code are in
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Install

```bash
npm i @particle-academy/fancy-chat-js @particle-academy/fancy-chat-ui
npx fancy-chat-check-install
```

- **Peers:** `@particle-academy/fancy-chat-js >=0.3.1 <2.0`,
  `@particle-academy/react-fancy >=6.28.0 <7.0`, `react ^19`, `react-dom ^19`.
  Optional: `@particle-academy/fancy-echarts` (for `./charts`) and
  `@particle-academy/prism-graph` (types for `./knowledge`).
- **Node:** `>=22`.
- The server side is `particle-academy/fancy-chat-php`, or any server that
  implements the fancy-chat-js contract.

## Find it on the Fancy MCP server

The catalog server is `https://ui.particle.academy/mcp` (streamable HTTP, no API
key; MCP id `fancy-ui`). This package is listed there: find it with
`search-components`.

## API essentials

- `createHttpTransport({ baseUrl, threadId, mode? })`: SSE with long-poll fallback
  (`auto`, the default), `poll`, or `interval` for a host that cannot hold a request
  open (one PHP worker, a small FPM pool).
- `useAgentThread({ transport })` returns `rows`, `state`, `capabilities`,
  `activeTurn` and the actions (`send`, `decide`, `answer`, `cancel`, `retry`, ...).
- `AgentThread` renders the thread; `AgentComposer` is the per-thread-draft composer
  with Stop. The README's "Use" section shows the wiring.
- `AgentThread` custom approvals:

  | prop | type | default | what it does |
  |---|---|---|---|
  | `renderApproval` | `(record: ApprovalRecord, ctx: { actionable, onDecide, labels }) => ReactNode \| undefined` | none | replaces the approval card in approval rows AND message parts. `undefined` keeps the default `ApprovalCard`, `null` renders nothing for that approval, anything else replaces the card |

  It is presentation only: decide through `ctx.onDecide`, and respect `ctx.actionable`
  (it is not enforced for you outside the default card, and neither is the card's
  in-flight lock, so guard a double click). Hiding the actionable approval with `null`
  does not skip it: later approvals keep waiting until it is decided. The
  `data-fancy-chat-approval` handle stays either way, without `-busy`, which only the
  default card knows. A hidden row is not in the virtual list, so `scrollToId` to it
  resolves `false`.
- `AgentComposer` attaching:

  | prop | type | default | what it does |
  |---|---|---|---|
  | `attachments` | `boolean` | `true` | passed to react-fancy PromptInput (needs `>=6.28.0`). `false` is for a backend that takes no files: no Attach button, no file input, no drop target, no file paste (text paste still works), and `onSend` always gets `attachments: []` |
- `AgentThread` quick replies (chips under the agent's last reply; the server makes
  them, off by default, see fancy-chat-php `suggestions`):

  | prop | type | default | what it does |
  |---|---|---|---|
  | `suggestions` | `readonly QuickReply[]` (`{ id, text }`) | none | the chips, controlled. Pass `chat.suggestions` |
  | `onSuggest` | `(suggestion: QuickReply) => void` | none | a pick. Without it no chips render |
  | `suggestionsHidden` | `boolean` | `false` | hides the chips for your own decision states (an approval-queue modal, say) |

  ```tsx
  const chat = useAgentThread({ transport });
  // send it as an ordinary message...
  <AgentThread {...rest} suggestions={chat.suggestions} onSuggest={chat.sendSuggestion} suggestionsHidden={queueOpen} />
  // ...or fill the composer instead
  <AgentThread {...rest} suggestions={chat.suggestions} onSuggest={(s) => setDrafts({ ...drafts, [threadId]: suggestionDraft(s) })} />
  ```

  Chips are hidden while any turn is unsettled, while an approval is pending or a
  question open, and once the newest message is the human's. Handles:
  `data-fancy-chat-suggestions` (the group, `role="group"`, labelled by
  `labels.quickReplies`) and `data-fancy-chat-suggestion="<id>"` (each chip, a real
  button: Tab, Enter or Space, and the arrow keys between chips). Also exported:
  `QuickReplies` (the chips alone), `quickRepliesHidden(state, { hidden })`,
  `suggestionsOf(state)`, `suggestionDraft(s)`, `suggestionMessage(s)`;
  `useAgentThread` returns `suggestions` and `sendSuggestion`.

  The server makes quick replies in a job AFTER the turn settles. With
  `mode: "interval"` the transport keeps polling after a `completed` settle until
  they arrive, for up to `interval.suggestionsMs` (default 15000, the server's
  `suggestions.timeout_seconds`; `0` turns it off). You need no `idleMs` and no
  polling loop of your own; match `suggestionsMs` to a longer server timeout.
- Building blocks: `PartView`, `ThinkingBlock`, `ToolRow`, `PlanRow`,
  `ActivityTimeline`, `ModelError`, `ApprovalCard`, `QuestionForm`, `QueueBar`,
  `UndoCountdown`, `createTriggerRegistry`, `serializePill`, `defineSurfaceProfile`.
- Optional entries: `@particle-academy/fancy-chat-ui/charts` (`chartPartRenderer`,
  `FactGraph`) and `@particle-academy/fancy-chat-ui/knowledge` (`KnowledgeExplorer`,
  `FactsExplorer`). The root entry never imports them.
- Display props on the facts views (all optional; omit them for the defaults):

  | prop | on | default |
  |---|---|---|
  | `formatDate?: (iso: string) => string` | `FactsExplorer`, `FactGraph` | `defaultFormatDate`: `Intl.DateTimeFormat` medium date + short time in the user's locale; an unparseable value shows as it came |
  | `evidenceLabel?: (evidence: KnowledgeChunk) => string` | `FactsExplorer` (the line under a passage) | `defaultEvidenceLabel`: `sourceTitle`, heading path, URI, lines, trust |
  | `evidenceLabel?: (evidence: KnowledgeChunk) => string` | `FactGraph` (an evidence node's name) | `defaultGraphEvidenceLabel`: `sourceTitle`, else the passage's first 60 characters; a chunk not loaded shows its id |

  `FactsExplorer` hands its `formatDate`, and its `evidenceLabel` when you pass one,
  to the `graph` component. `sourceTitle` on a chunk is optional; your adapter fills
  it (fancy-chat-php's `KnowledgeBridge` does).
- Every component is controlled, carries `data-fancy-chat-*` handles, and takes
  `labels`. To let a co-driving agent reach the surface, use
  `registerAgentChatBridge` from `@particle-academy/agent-integrations`
  (`./bridges/agent-chat`); it has no decide, answer or send tool.

## Traps

- **Decisions carry no actor.** `decide` sends `{ optionId, note? }`; the server
  resolves the actor. Do not try to pass one.
- **Attachments are uploaded by the host.** `onSend` receives `attachments` with
  their `File`; upload to your own storage and send each as an `image` / `file` part
  carrying your `ref`. The server never accepts bytes in a message, and a restored
  draft's chips carry no `File`.
- **Hide Stop when the backend cannot cancel:** `canStop={chat.capabilities?.cancel !== false}`.
- **A quick reply is only ever a message.** Wire `onSuggest` to `chat.sendSuggestion`
  (one plain-text part on the message route) or to a composer fill
  (`suggestionDraft`); never to `decide`, `answer` or a tool. Chip text is model
  output and renders as plain text. `chat.suggestions` needs a fancy-chat-js with
  `suggestions.updated` (and a server that sends it); with an older one it is `[]`.
- **Raw ECharts options render only with `chartPartRenderer({ allowRawOptions: true })`.**
