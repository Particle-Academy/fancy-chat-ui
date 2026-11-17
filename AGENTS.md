# Using @particle-academy/fancy-chat-ui — guide for agents

How an agent installs and uses this package in a consumer app. What the package
is, is in [README.md](./README.md). Notes for working ON this repo's code are in
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Install

```bash
npm i @particle-academy/fancy-chat-js @particle-academy/fancy-chat-ui
npx fancy-chat-check-install
```

- **Peers:** `@particle-academy/fancy-chat-js >=0.1.0 <2.0`,
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
- Building blocks: `PartView`, `ThinkingBlock`, `ToolRow`, `PlanRow`,
  `ActivityTimeline`, `ModelError`, `ApprovalCard`, `QuestionForm`, `QueueBar`,
  `UndoCountdown`, `createTriggerRegistry`, `serializePill`, `defineSurfaceProfile`.
- Optional entries: `@particle-academy/fancy-chat-ui/charts` (`chartPartRenderer`,
  `FactGraph`) and `@particle-academy/fancy-chat-ui/knowledge` (`KnowledgeExplorer`,
  `FactsExplorer`). The root entry never imports them.
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
- **Raw ECharts options render only with `chartPartRenderer({ allowRawOptions: true })`.**
