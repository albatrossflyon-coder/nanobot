# MAMA, nanobot, and Obsidian World: transaction remapping decision

**Date:** 2026-08-15  
**Status:** Architecture decision baseline  
**Decision:** Do not compose `mama-os`, nanobot, and obsidian-mind as three peer runtimes. Make **MAMA OS the daemon and source/memory runtime**, retain the Obsidian World transaction contract as a target-owned control boundary, and use nanobot only as an optional worker/channel adapter where it adds capabilities MAMA does not already provide.

## Executive conclusion

The new MAMA repository changes the earlier recommendation materially. MAMA is not merely an Obsidian plugin or an MCP memory server. Its `mama-os` package is explicitly an always-on server with connectors, trigger loops, reports, a task board, a web UI, and standing workers. Its `mama-core` package owns local memory, provenance, graph, embeddings, scopes, and retrieval. Its `mama-server` package is a thin MCP adapter over that core. The repository also documents evidence/effect tracking, checkpoint and restart metrics, audit-conversation processing, and channel-grant enforcement [1] [2].

That means the original architecture would create two competing control planes if both `mama-os` and nanobot were treated as always-on daemons. It would also create a memory-model collision if obsidian-mind and MAMA core were both treated as canonical. The transaction specification should therefore be **re-mapped onto MAMA**, but not discarded. The specification becomes the contract that constrains MAMA’s runtime and bridges incoming events, durable memory, worker execution, and outbound delivery.

The cleanest composition is:

```text
MAMA OS daemon
  ├── connectors and scheduled intake
  ├── transaction coordinator / lifecycle contract
  ├── OB1 execution state and effect ledger
  ├── MAMA core as canonical structured memory
  ├── Obsidian as a durable human-readable projection or source
  ├── MCP server surface for agents and external clients
  └── optional nanobot adapter for channels/tools/workers that MAMA does not provide
```

**Daemon ownership belongs to MAMA OS.** Nanobot should not run a second daemon in the same deployment. If nanobot is retained, it should run as a bounded worker runtime, channel adapter, or MCP client under MAMA’s transaction control.

## Why the original three-piece composition is unsafe

The proposed `nanobot + obsidian-mind + MAMA` stack contains three overlapping categories:

| Piece | Existing architectural role | Collision if treated as a peer |
|---|---|---|
| MAMA OS | Always-on daemon, connector host, trigger loop, reports, task board, standing workers | Competes with nanobot for scheduling, intake, worker dispatch, and outbound routing |
| MAMA core | Local SQLite memory, embeddings, provenance, graph, scopes, evolution | Competes with obsidian-mind for canonical memory and retrieval semantics |
| MAMA server | MCP adapter over MAMA core | Overlaps with obsidian-mind’s MCP server surface |
| Nanobot | Runtime with channels, tools, model routing, MCP, memory, worker dispatch | Becomes a second coordinator if allowed to own transactions and daemon lifecycle |
| Obsidian-mind | Obsidian/vault-first memory and agent interoperability model | Becomes a second memory authority if allowed to own recall and writes beside MAMA core |
| Obsidian World contract | Target-owned transaction, policy, idempotency, durable-write, and recovery contract | Must sit above or inside one runtime, not be implemented independently by all three |

The failure mode is not merely duplicated functionality. It is **ambiguous authority**. A duplicate email could be deduplicated by nanobot, MAMA, or the bridge. A durable memory could be written to Obsidian, MAMA SQLite, or both with different supersession semantics. A report could be delivered by MAMA while nanobot believes the transaction is still pending. A worker restart could be resumed from MAMA’s checkpoint, the bridge’s OB1 state, or nanobot’s local state.

## Revised ownership model

### System-of-record decisions

| Concern | Owner | Boundary |
|---|---|---|
| Always-on process, scheduling, connector polling, trigger loop | `mama-os` | MAMA daemon lifecycle and trigger/workorder APIs |
| Transaction identity, lifecycle, state transitions, idempotency | Obsidian World transaction layer implemented inside or adjacent to `mama-os` | One `transaction_id`, one state machine, one effect ledger |
| Ephemeral execution state | OB1/session-state repository | Checkpoints, leases, attempts, artifacts, delivery state |
| Structured searchable memory | `mama-core` | SQLite, embeddings, graph, scopes, truth projection, provenance |
| Human-readable durable knowledge | Obsidian vault | Markdown notes, decisions, research records, daily pages |
| Obsidian synchronization/projection | MAMA connector or controlled memory adapter | Explicit direction and conflict policy; never implicit dual-write |
| MCP access to memory | `mama-server` for MAMA core; optional Obsidian MCP for vault operations | Capability-scoped tool catalog |
| Worker execution | MAMA standing workers by default; nanobot only as bounded adapter | Worker receives a task lease and returns a typed result |
| External channel response | MAMA connector/delivery lane | Explicit permission and idempotent delivery key |

### Canonical memory choice

MAMA core and Obsidian should not both be called “canonical memory” without a documented split. The recommended split is:

> **MAMA core is the canonical operational memory index; Obsidian is the canonical human-readable durable record.**

MAMA core should own typed memory units, scopes, embeddings, graph edges, truth projection, provenance, and fast recall. Obsidian should own the durable Markdown artifacts a human is expected to read, edit, review, and preserve. A bridge or connector maintains explicit links between the two, such as `mama_memory_id`, `obsidian_note_id`, `source_transaction_id`, and content hashes.

This is different from the earlier obsidian-mind-first recommendation. MAMA’s repository already provides a serious local memory engine and an always-on runtime. Retaining obsidian-mind as a second independent memory engine would be unnecessary unless it provides a capability MAMA cannot reproduce or the user specifically wants its agent-hook conventions.

## Direct lifecycle remapping

| Existing transaction stage | Earlier nanobot-centered owner | Recommended MAMA-centered owner | Integration point |
|---|---|---|---|
| `received` | Nanobot channel adapter | MAMA connector or MAMA ingress lane | Normalize provider event into `InboundEnvelope` and assign `transaction_id` |
| `sanitized` | Bridge | MAMA transaction coordinator | Validate sender, links, attachment metadata, and policy |
| `classified` | Nanobot classifier | MAMA trigger/conductor lane | Produce intent, confidence, route, permissions, and review requirement |
| `context_loaded` | obsidian-mind search/read | MAMA core recall plus optional Obsidian read | Build scoped context bundle with provenance and content hashes |
| `planned` | Nanobot tool loop | MAMA workorder/task planner | Convert route into bounded steps, capabilities, leases, and expected artifacts |
| `executing` | Nanobot worker loop | MAMA task board and worker runtime | MAMA owns lease; nanobot may execute one step as a worker adapter |
| `persisting` | obsidian-mind controlled write | MAMA memory writer plus Obsidian projection writer | Validate durable artifact, save MAMA memory, then write or update Markdown projection |
| `responding` | Nanobot channel delivery | MAMA outbound connector | Queue and deliver with provider idempotency key |
| `completed` | Bridge checkpoint | MAMA effect ledger and transaction record | Confirm completed effects, artifacts, provenance, and delivery |
| `needs_review` / `failed` | Bridge/operator console | MAMA approval inbox and operator viewer | Pause without guessing; resume only through an explicit transition |

## What should happen to the transaction specification

The transaction specification should be preserved as a **runtime-neutral contract**, but its implementation mapping changes.

### Keep unchanged

The following concepts remain valid and should remain target-owned:

| Contract concept | Reason to retain |
|---|---|
| `InboundEnvelope` | Prevent provider-specific payloads from leaking into the workflow |
| Explicit classification states | Make routing and review decisions inspectable |
| `transaction_id` and idempotency key | Prevent duplicate intake and repeated side effects |
| Step leases and attempts | Make worker execution restart-safe |
| Typed artifacts | Separate drafts, sources, durable notes, and delivery receipts |
| Durable-write validation | Prevent workers from writing arbitrary canonical knowledge |
| Review gates | Keep external sends and unsafe actions explicit |
| Append-only lifecycle events | Support recovery, audit, and operator inspection |
| Separate ephemeral state from durable memory | Prevent checkpoints from polluting human knowledge |

### Re-map or remove

| Earlier contract element | Revised treatment |
|---|---|
| Nanobot-owned coordinator | Replace with MAMA OS transaction/conductor lane |
| obsidian-mind as sole memory gateway | Replace with MAMA core as primary memory gateway; keep an Obsidian adapter for Markdown artifacts |
| Separate bridge HTTP service for every operation | First implement as MAMA OS modules/workorder handlers; expose HTTP only where an external client needs it |
| Nanobot worker loop as default | Make MAMA’s standing workers default; retain nanobot loop as an adapter implementation |
| OB1 as an independent external state system | Keep the logical separation, but place the implementation in MAMA’s session/workorder/effect stores where possible |
| RAG as separate canonical system | Treat MAMA core retrieval as the primary index; maintain any external RAG as a projection/benchmark |

## The answer to “which one owns the daemon role?”

**MAMA OS owns the daemon role.** This is not merely a preference; it follows from the repository’s documented boundaries. MAMA OS is the package that stays running, owns connectors and trigger loops, produces reports, manages the task board, and executes standing workers. MAMA core is explicitly a lower-level library, and mama-server is explicitly a thin MCP adapter [1].

Nanobot should own none of the following in the MAMA-centered deployment: the primary scheduler, connector polling, global transaction identity, canonical retry state, outbound delivery authority, or system-wide memory writes. It may own the execution of a bounded worker step, especially where its model/tool/channel support is valuable.

If the team decides that nanobot’s runtime is dramatically better for the actual task loop, then the alternative is to make **nanobot the daemon and demote MAMA OS to a memory/connectors library**. That would require bypassing or disabling MAMA OS’s daemon, trigger, report, task-board, and worker-runtime features. Running both full daemons is the option to reject.

## Recommended composition patterns

### Pattern A — MAMA-centered; recommended

```text
MAMA OS daemon
  → transaction coordinator
  → MAMA connector intake
  → MAMA core memory and provenance
  → Obsidian projection/source adapter
  → MAMA worker lanes
  → optional nanobot worker adapter
  → MAMA delivery connector
```

Use this when the priority is a coherent always-on operating system with local memory, source connectors, auditability, reports, and a single operator surface.

### Pattern B — Nanobot-centered; viable only if deliberately chosen

```text
Nanobot daemon
  → transaction coordinator
  → nanobot channels/tools
  → MAMA core via MCP
  → Obsidian projection adapter
  → nanobot workers
  → nanobot delivery
```

In this pattern, `mama-os` should not run as a second daemon. Use `mama-core` and possibly `mama-server` as memory components, or extract the specific MAMA connector logic required. This is more invasive because MAMA’s core is packaged beneath its own runtime assumptions, but it is coherent.

### Pattern C — Three full pieces; reject

```text
MAMA OS daemon ↔ nanobot daemon ↔ obsidian-mind MCP
```

Reject this unless there is an explicit federation protocol with one leader, one transaction identity, one memory authority, and one delivery authority. Without that, each runtime can observe, retry, write, and report the same work independently.

## Practical migration plan

### Phase 0 — Freeze the authority map

Document that MAMA OS is the daemon, MAMA core is the structured memory engine, Obsidian is the human-readable durable record, and nanobot is optional worker/channel infrastructure. Add a `system_owner` field to every transaction and require it to be `mama-os` in the first deployment.

### Phase 1 — Adapt the transaction schema to MAMA

Keep the existing envelope and state names, then add MAMA-native identifiers:

```json
{
  "transaction_id": "txn_...",
  "mama_run_id": "run_...",
  "workorder_id": "wo_...",
  "memory_scope": {"kind": "project", "id": "obsidian-world"},
  "mama_memory_ids": [],
  "obsidian_note_ids": [],
  "source_event_ids": [],
  "effect_ids": [],
  "worker_adapter": "mama-native"
}
```

### Phase 2 — Prove a MAMA-native vertical slice

Start with one connector, one classification route, one MAMA worker lane, one MAMA core recall, one Obsidian projection, and one outbound response. Do not involve nanobot yet. This establishes whether MAMA already satisfies the full transaction lifecycle.

### Phase 3 — Add nanobot as a bounded worker adapter

Expose a MAMA workorder to nanobot through one adapter boundary. MAMA grants the lease and capabilities; nanobot returns a typed result and artifact hashes. Nanobot cannot commit memory directly or send an external response directly.

### Phase 4 — Decide whether obsidian-mind remains

Keep obsidian-mind only if its Obsidian-specific read/write, agent-hook, or vault-navigation behavior provides a measurable benefit. If retained, make it a projection adapter or MCP tool provider under MAMA’s capability policy—not a second canonical memory engine.

### Phase 5 — Remove duplicate state and daemons

Disable any nanobot scheduler, duplicate email poller, duplicate report loop, or independent memory writer that overlaps with MAMA. Run failure tests for duplicate intake, restart, MCP outage, stale lease, Obsidian write timeout, and uncertain delivery.

## Decision gates

| Gate | Pass condition | Decision |
|---|---|---|
| Daemon gate | One process owns intake, scheduling, retries, and delivery | MAMA OS selected as daemon |
| Memory gate | One structured memory authority and one human-readable durable projection are explicit | MAMA core + Obsidian split accepted |
| Transaction gate | Every event has one transaction ID, state owner, and effect ledger | Re-mapped spec accepted |
| Worker gate | Nanobot can execute a bounded task without writing memory or sending externally | Nanobot retained as adapter |
| Obsidian gate | Vault writes are validated, attributable, and idempotent | Obsidian adapter enabled |
| Expansion gate | Duplicate and restart tests pass | Add more workers/connectors only afterward |

## Final recommendation

Re-map the transaction specification onto MAMA OS rather than continuing with a nanobot-centered daemon design. Do **not** compose three full peers. Use MAMA OS as the only daemon, MAMA core as the structured operational memory engine, Obsidian as the human-readable durable layer, and nanobot as an optional bounded worker runtime. Keep the existing transaction contract because it supplies the missing cross-component authority model: one identity, one state machine, one policy boundary, one effect ledger, and one recovery story.

The next implementation should be a **MAMA-native first vertical slice**, followed by a nanobot adapter only if it improves a measured worker or channel capability. This reverses the earlier “nanobot runtime baseline” recommendation because the new MAMA evidence shows that MAMA already owns the daemon role the proposed architecture was about to build.

## References

[1]: https://github.com/jungjaehoon-lifegamez/MAMA "MAMA OS repository README: daemon, packages, connectors, reports, MCP, local memory, and runtime responsibilities"
[2]: https://raw.githubusercontent.com/jungjaehoon-lifegamez/MAMA/main/CLAUDE.md "MAMA repository engineering guide: package responsibilities, MCP tools, memory model, scopes, provenance, checkpoints, and evidence/effects"
[3]: https://github.com/HKUDS/nanobot "HKUDS/nanobot repository: lightweight agent runtime, channels, tools, MCP, memory, and worker dispatch baseline"
