# HKUDS/nanobot vs. Obsidian World

**Purpose:** Identify exactly where the HKUDS/nanobot runtime can serve the proposed Obsidian World transaction lifecycle, where it must be wrapped, and what must remain outside nanobot.

## Executive decision

Use **HKUDS/nanobot as the runtime and channel coordinator**, but do not adopt its internal memory or agent loop as the complete Obsidian World architecture. Place a target-owned transaction adapter around nanobot’s inbound and outbound boundaries, use OB1 for checkpoints and ephemeral state, and expose obsidian-mind’s vault-first MCP interface as the durable-memory service.

The governing rule is:

> Nanobot coordinates the transaction; obsidian-mind exposes the durable knowledge; OB1 records execution state; worker agents perform bounded work.

This preserves the user’s intended separation between orchestration, durable knowledge, session state, retrieval, and workers while reusing nanobot’s existing runtime capabilities.

## Direct lifecycle comparison

| Obsidian World stage | HKUDS/nanobot capability | Decision | Exact integration point | Required contract or test |
|---|---|---|---|---|
| `received` | Supports messages from channels including email and chat apps; the agent loop accepts incoming messages [1] | Use directly behind an adapter | Nanobot channel adapter → `InboundEnvelope` | Preserve provider message ID, thread ID, sender, timestamps, attachments, and raw archive URI |
| `sanitized` | Provides channel and tool handling, but the target contract requires explicit authorization and content normalization | Wrap | Add `input_normalizer` before the nanobot agent loop | Reject unauthorized senders; extract links; preserve raw input; never execute attachments automatically |
| `classified` | LLM-driven tool/agent selection can infer intent, but the target needs explicit typed intent, confidence, route, and prohibited actions | Wrap | Add `classifier` node or pre-agent routing hook | Emit `ClassificationResult`; low confidence enters `needs_review`; test unknown and unsafe requests |
| `context_loaded` | Has long-term memory/context behavior and MCP integrations [1] | Replace memory surface with target-owned adapter | Register obsidian-mind MCP tools as nanobot tools; read OB1 separately | Obsidian is canonical; retrieval returns note IDs, paths, excerpts, and provenance |
| `planned` | Nanobot’s small agent loop can select tools and skills | Wrap | Add a bounded `TransactionPlanner` tool or pre-execution policy layer | Plan must list steps, permissions, worker, expected artifacts, and prohibited actions |
| `executing` | Supports tools, MCP, model routing, and multi-agent delegation [1] | Use directly with policy wrapper | Nanobot tool registry and worker delegation | Agents are workers; external side effects require explicit policy; persist step checkpoints in OB1 |
| `persisting` | Nanobot has memory/persistent storage, but the target requires Obsidian note schemas and idempotent writes | Replace default durable write path | Register `obsidian_write` through obsidian-mind MCP or a target-owned writer | Validate front matter; deterministic note identity; never silently create a second canonical store |
| `responding` | Channel layer can send messages, including email [1] | Use directly behind delivery adapter | Nanobot channel response path → `OutboundResponse` | Use delivery idempotency key; distinguish sent, queued, and uncertain delivery |
| `completed` | Runtime can finish an agent turn | Wrap | Terminal-state handler | Write terminal OB1 state and event; include note path, transaction ID, warnings |
| `needs_review` | Nanobot may continue agent execution unless constrained | Add explicitly | Review policy and reply/resume handler | Pause execution; ask one focused question; resume same transaction without duplication |
| `failed_retryable` | Runtime can encounter provider/tool failures | Wrap | Retry supervisor outside the agent loop | Retry only current step; bounded backoff; do not repeat completed side effects |
| `failed_permanent` | No target-specific failure taxonomy by default | Add explicitly | Error classifier and terminal-state writer | Record stable error code, operator action, and user-safe response |

## Exact seams to implement

### 1. Channel adapter

Keep nanobot’s email or messaging channel implementation, but normalize its output into the target-owned `InboundEnvelope`. The adapter is responsible for sender authorization, provider identifiers, raw-message archival, link extraction, attachment metadata, and idempotency-key derivation.

### 2. Transaction wrapper

Create a thin wrapper around the nanobot agent loop. The wrapper creates or retrieves the transaction record, advances the lifecycle state, acquires a lease, and ensures that each tool call is associated with a transaction and step ID.

### 3. Policy-aware classifier

Do not rely on an unstructured system prompt to determine whether a request is safe. Require a typed `ClassificationResult` with `intent`, `confidence`, `route`, `required_capabilities`, `prohibited_actions`, and `review_required`. This result becomes the first durable execution artifact in OB1.

### 4. Obsidian MCP provider

Expose obsidian-mind’s MCP surfaces as nanobot tools. At minimum, register `search`, `read`, `expand`, `recall`, `remember`, `record_work`, and `health` where available [2]. Wrap writes so the transaction layer can validate note front matter, enforce scope, and associate every write with a transaction ID.

### 5. Session-state provider

Keep OB1 outside the Obsidian vault. Nanobot should write transaction checkpoints, current step, attempts, leases, retrieved context IDs, draft artifact IDs, and outbound delivery status to OB1. The vault should contain durable findings, decisions, project notes, and curated research—not raw workflow state.

### 6. Worker adapter

Treat Claude Code, Codex CLI, Gemini CLI, and other agents as workers. A worker receives a bounded task, relevant Obsidian context, explicit tool permissions, and a result schema. It must return a structured artifact rather than directly deciding where canonical memory belongs.

### 7. Response and delivery adapter

Use nanobot’s channel implementation for outbound delivery, but add a target-owned delivery record. If email times out after a successful Obsidian write, retry delivery only. Never rerun research or create another note solely because response delivery is uncertain.

## Boundary decisions

| Capability | Nanobot | Obsidian World owner |
|---|---|---|
| Channel connection | Runtime | Nanobot adapter |
| Transaction identity | Not assumed | Transaction wrapper |
| Intent classification | Model/tool capability | Typed classifier contract |
| Durable knowledge | Do not adopt implicitly | Obsidian via obsidian-mind |
| Session state | Runtime session support is insufficient as the contract | OB1 |
| Retrieval | Runtime memory can assist | RAG projection over Obsidian |
| Structural graph | Not nanobot’s responsibility | Graphify |
| Worker execution | Nanobot delegation/tool loop | Worker adapter and policy layer |
| External account actions | Must not be implicit | Explicit review/policy gate |
| Monitoring | Runtime/WebUI signals | Omni-console projection |

## Main technical risk

The central risk is not connecting nanobot to Obsidian. It is allowing nanobot’s convenient internal memory, session history, or agent-generated files to become a second source of truth. The integration should therefore make the durable-write path explicit and testable from the beginning.

## References

[1]: https://github.com/HKUDS/nanobot "HKUDS/nanobot repository"
[2]: https://github.com/breferrari/obsidian-mind "breferrari/obsidian-mind repository"
