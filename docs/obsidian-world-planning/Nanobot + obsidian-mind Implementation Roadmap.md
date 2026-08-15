# Nanobot + obsidian-mind Implementation Roadmap

## Target outcome

Combine HKUDS/nanobot’s lightweight, self-hosted agent runtime and channel layer with obsidian-mind’s vault-first memory model without creating competing brains. The first production-worthy slice is an email-triggered capture/research transaction that writes a validated durable note, updates OB1 session state, and returns an idempotent response.

## Proposed topology

```text
Email / phone
     │
     ▼
Nanobot channel adapter
     │
     ▼
Transaction wrapper ───────► OB1: checkpoints, leases, attempts, delivery state
     │
     ├── classifier / policy gate
     │
     ├── obsidian-mind MCP ─► Obsidian vault: durable notes and linked knowledge
     │                         │
     │                         ├── graphify: structural projection
     │                         └── RAG: retrieval projection
     │
     └── worker adapter ─────► Claude Code / Codex / Gemini / other bounded workers
     │
     ▼
Nanobot outbound channel ───► Email response
```

## Phase 0 — Freeze contracts before integration

Create the repository-level contracts first. Adopt the Nanobot Transaction Specification as the normative reference for `InboundEnvelope`, `ClassificationResult`, lifecycle states, Obsidian front matter, OB1 session state, event records, idempotency, retries, and response templates.

**Deliverables:** shared JSON Schemas or typed models; error-code registry; state-transition table; explicit action-permission policy; test fixtures for capture, research, question, task, unknown, duplicate, and unsafe requests.

**Exit criteria:** a transaction can be represented and validated without importing nanobot or obsidian-mind internals.

## Phase 1 — Run nanobot unchanged as a channel and agent baseline

Deploy nanobot locally with one channel, preferably email, one model provider, and a minimal tool set. Do not connect durable writes yet. Capture inbound envelopes and outbound responses in a test harness.

Add a `transaction_id` and idempotency key at the channel boundary. Store raw inputs in a protected test archive and verify that duplicate provider deliveries do not create duplicate transaction records.

**Exit criteria:** nanobot can receive a message, produce a typed envelope, invoke a no-op or echo worker, and return one response with stable correlation metadata.

## Phase 2 — Add the transaction wrapper and OB1 checkpoints

Wrap the agent loop with a small coordinator that owns lifecycle state, leases, step attempts, and terminal outcomes. Do not modify nanobot’s internal reasoning more than necessary; intercept at message ingress, tool invocation, and response egress.

Implement checkpoint writes before and after each meaningful step: classification, context retrieval, worker execution, durable persistence, and response delivery. Add restart tests that kill the process between checkpoints and resume from OB1.

**Exit criteria:** a restarted process resumes the same transaction, skips completed idempotent steps, and never duplicates a durable write or outbound response.

## Phase 3 — Register obsidian-mind as the durable memory provider

Expose obsidian-mind’s MCP server to nanobot as a named provider. Register read tools first: `search`, `read`, `expand`, `recall`, and `health`. Add `remember` and `record_work` only after the read path is verified.

Create a target-owned Obsidian adapter that converts MCP responses into the transaction context contract. Preserve note IDs, paths, links, provenance, scope, and confidence. Treat the vault as canonical; do not mirror the vault into a new memory database except as a clearly labeled retrieval index.

**Exit criteria:** a transaction can search and read relevant vault notes, expose provenance to the worker, and report MCP health without writing anything.

## Phase 4 — Implement controlled durable writes

Add `obsidian_write` as a constrained operation. Validate front matter and required headings before the write. Compute deterministic note identity from transaction and canonical target. Resolve whether the action is create, append-only enrichment, or explicit update. Record the resulting note ID and path in OB1.

Keep raw email bodies, tool traces, intermediate prompts, and transient worker status out of the vault. Write only curated durable knowledge, decisions, research summaries, project documentation, or explicit task outcomes.

**Exit criteria:** three representative requests produce readable, correctly located notes; duplicate delivery produces one note; malformed output is rejected before persistence.

## Phase 5 — Add bounded workers

Introduce one worker route at a time. Start with a capture worker and a research worker. Pass each worker a typed task, relevant context, explicit permissions, and a result schema. Workers may propose durable content, but the transaction layer owns note placement, validation, and persistence.

Add Claude Code, Codex CLI, or Gemini CLI only through a common adapter. The adapter should normalize worker status, output, failure, and cancellation semantics. Use obsidian-mind’s shared vault conventions and hooks where compatible, but do not let worker-specific hooks bypass transaction state.

**Exit criteria:** workers are interchangeable for the same bounded task; the same request can be processed by two workers without changing the canonical note schema.

## Phase 6 — Add retrieval projections and monitoring

After durable writes are reliable, connect the existing RAG system as a projection of Obsidian. Ingest from the vault, attach note IDs and update timestamps to indexed documents, and define stale-index behavior. Add graphify as a separate structural projection.

Expose transaction state, MCP health, vault indexing state, worker status, and failures to Omni-console. The dashboard observes and controls; it does not become an autonomous coordinator or second knowledge store.

**Exit criteria:** RAG or graphify can be disabled without losing knowledge or preventing direct vault access; stale or unavailable projections are visible as warnings.

## Phase 7 — Move the minimal core to production

Develop locally, then deploy only the always-on core: nanobot, email channel, transaction wrapper, OB1 access, obsidian-mind access, and minimal scheduling. Keep NotebookLM, graph experiments, extra agents, and heavy indexing out of the initial production footprint.

Before production, verify secret handling, sender authorization, backups, vault synchronization, process restart, rate limits, error notification, and manual recovery. If the runtime requires custom system packages or exceeds the managed host’s resource limits, use a full Linux host; otherwise prefer a managed always-on service.

**Exit criteria:** the system can run unattended, recover from restarts, preserve durable knowledge, and surface intervention-required failures.

## Recommended repository strategy

| Area | Strategy | Reason |
|---|---|---|
| Nanobot runtime | Fork or vendor only if required; otherwise pin and wrap | Preserve upstream update path and keep target contracts outside runtime internals |
| obsidian-mind | Use as a vault template and MCP/reference layer | Its durable-memory and cross-agent patterns match the target closely |
| Transaction contracts | Own in a separate integration package | Prevent either upstream project from redefining the source of truth |
| OB1 state | Own separately | Session state is intentionally not durable vault knowledge |
| RAG and graphify | Keep as projections | They should be rebuildable from Obsidian |
| Omni-console | Defer until the first circuit is stable | Observability is valuable; another orchestration brain is not |

## First six implementation tickets

| Ticket | Scope | Acceptance criterion |
|---|---|---|
| T1 | Add normalized inbound envelope and idempotency key | Duplicate email produces one transaction |
| T2 | Add OB1 transaction and event records | State transitions and leases survive restart |
| T3 | Add typed classifier and review gate | Unknown or unsafe requests pause safely |
| T4 | Connect obsidian-mind read MCP tools | Search/read returns cited note context |
| T5 | Add validated idempotent Obsidian writer | Research request produces one canonical note |
| T6 | Add outbound delivery record | Delivery retry does not rerun processing |

## Explicitly defer

Do not initially integrate Octop, NotebookLM, understand-anything, additional graph databases, another RAG system, more coding agents, or a redesigned Omni-console. Each can be evaluated after the first transaction passes the acceptance suite and after a concrete requirement demonstrates that the existing layer is insufficient.

## References

[1]: https://github.com/HKUDS/nanobot "HKUDS/nanobot repository"
[2]: https://github.com/breferrari/obsidian-mind "breferrari/obsidian-mind repository"
[3]: https://github.com/langchain-ai/executive-ai-assistant "LangChain Executive AI Assistant repository"
