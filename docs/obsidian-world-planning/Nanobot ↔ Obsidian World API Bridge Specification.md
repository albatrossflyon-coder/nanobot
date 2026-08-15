# Nanobot ↔ Obsidian World API Bridge Specification

**Version:** 0.1  
**Status:** Proposed implementation contract  
**Scope:** API and MCP operations required to connect the nanobot runtime to the Obsidian World transaction lifecycle and obsidian-mind vault-first memory model.

## 1. Architectural position

The bridge should be a **target-owned control plane** placed around nanobot rather than a set of ad hoc calls embedded in individual agents. Nanobot remains responsible for channels, its agent loop, tool registration, model routing, worker dispatch, and outbound transport. The bridge owns transaction identity, lifecycle state, policy, idempotency, checkpoints, durable-write validation, and recovery.

The bridge has four interfaces:

| Interface | Protocol | Primary consumer | Purpose |
|---|---|---|---|
| Runtime control API | HTTPS JSON | Nanobot adapter, Omni-console, operators | Start, inspect, resume, cancel, and observe transactions |
| Memory gateway | MCP JSON-RPC, optionally wrapped by HTTPS | Nanobot tools and workers | Search, read, expand, recall, write, and health operations over obsidian-mind |
| Session-state API | Internal HTTPS or database repository | Bridge workers and nanobot adapter | Store OB1 checkpoints, leases, attempts, artifacts, and delivery state |
| Delivery adapter | Internal service interface plus provider API | Nanobot channel layer | Send responses idempotently and report delivery status |

The API below is intentionally **not presented as the exact upstream nanobot HTTP API**. Upstream nanobot channel and gateway details may change; these are the stable contracts the Obsidian World integration should own around it.

## 2. Common conventions

### 2.1 Base URLs and versioning

Use separate logical origins even if the first deployment runs in one process:

```text
https://bridge.example.internal/api/v1
https://memory.example.internal/mcp
https://session.example.internal/api/v1
```

The first implementation may mount them behind one process and one host. Keep the path boundaries explicit so the services can be separated later without changing callers.

All JSON APIs use UTF-8 and return an envelope with a request ID:

```json
{
  "data": {},
  "request_id": "req_01J5NANOBOT123",
  "transaction_id": "txn_20260814_8f3d1a2c",
  "warnings": []
}
```

Errors use the following shape:

```json
{
  "error": {
    "code": "OBSIDIAN_WRITE_FAILED",
    "message": "The durable note could not be written.",
    "retryable": true,
    "stage": "persisting",
    "details": {},
    "request_id": "req_01J5NANOBOT123",
    "transaction_id": "txn_20260814_8f3d1a2c"
  }
}
```

### 2.2 Headers

Every request should support:

```text
Authorization: Bearer <service-token>
X-Request-ID: req_01J5NANOBOT123
X-Transaction-ID: txn_20260814_8f3d1a2c
Idempotency-Key: email:gmail:message_abc123
X-Caller: nanobot | worker:claude | omni-console | operator
X-Schema-Version: 0.1
```

`X-Transaction-ID` is required after a transaction has been created. `Idempotency-Key` is required on every operation that can create or mutate state.

### 2.3 HTTP status semantics

| Status | Meaning |
|---:|---|
| `200` | Synchronous read or successful mutation |
| `201` | New transaction, artifact, or durable-note record created |
| `202` | Accepted for asynchronous execution or delivery |
| `400` | Malformed request or schema violation |
| `401` | Missing or invalid service authentication |
| `403` | Caller lacks the required capability or policy permission |
| `404` | Transaction, artifact, or note target not found |
| `409` | Idempotency conflict, invalid state transition, or lease conflict |
| `412` | Version or optimistic-concurrency precondition failed |
| `422` | Well-formed request that fails domain validation |
| `429` | Rate limit or provider backpressure |
| `500` | Unexpected bridge failure |
| `502`/`503` | Upstream provider or memory service unavailable |

## 3. Runtime control API

### 3.1 `POST /api/v1/intake/messages`

**Purpose:** Accept a normalized or provider-originated message and create a transaction.

**Caller:** Nanobot channel adapter or email webhook/poller.

**Required request:**

```json
{
  "idempotency_key": "email:gmail:message_abc123",
  "source": {
    "channel": "email",
    "provider": "gmail",
    "account_id": "primary",
    "message_id": "message_abc123",
    "thread_id": "thread_xyz789",
    "in_reply_to": null
  },
  "sender": {
    "email": "user@example.com",
    "display_name": "Chris"
  },
  "recipients": ["nanobot@example.com"],
  "subject": "Research this GitHub project",
  "body": {
    "text": "Please investigate https://github.com/example/project.",
    "html": null
  },
  "links": [
    {"url": "https://github.com/example/project", "source": "body"}
  ],
  "attachments": [],
  "directives": {
    "reply_requested": true,
    "urgency": "normal"
  },
  "archive_uri": "archive://email/message_abc123"
}
```

**Response:** `201` for a new transaction, `200` for a duplicate delivery returning the existing transaction.

```json
{
  "data": {
    "transaction_id": "txn_20260814_8f3d1a2c",
    "state": "received",
    "duplicate": false,
    "next_action": "sanitize_and_classify"
  },
  "request_id": "req_...",
  "transaction_id": "txn_20260814_8f3d1a2c",
  "warnings": []
}
```

**Rules:** The endpoint must authenticate the sender or mark the transaction for review. It must never execute the request inline before returning the transaction identity.

### 3.2 `GET /api/v1/transactions/{transaction_id}`

**Purpose:** Retrieve transaction state, classification, current step, artifacts, warnings, and terminal outcome.

**Query parameters:**

```text
include=classification,plan,artifacts,errors,events
```

**Response fields:**

```json
{
  "data": {
    "transaction_id": "txn_20260814_8f3d1a2c",
    "state": "executing",
    "status": "running",
    "created_at": "2026-08-14T14:30:00Z",
    "updated_at": "2026-08-14T14:32:10Z",
    "classification": {},
    "plan": {},
    "current_step": "summarize",
    "artifacts": {},
    "warnings": [],
    "errors": []
  }
}
```

### 3.3 `GET /api/v1/transactions/{transaction_id}/events`

**Purpose:** Return append-only lifecycle events for debugging, replay analysis, and Omni-console.

**Query parameters:**

```text
from=2026-08-14T14:30:00Z
limit=100
cursor=...
```

Events include `from_state`, `to_state`, `actor`, `step`, `result`, `latency_ms`, and safe metadata. Do not include tokens, full private message bodies, or raw prompts.

### 3.4 `POST /api/v1/transactions/{transaction_id}/classify`

**Purpose:** Run or submit classification.

**Caller:** Bridge classifier or nanobot adapter.

**Request:**

```json
{
  "intent": "research",
  "confidence": 0.94,
  "route": "research_to_obsidian",
  "priority": "normal",
  "entities": {
    "topics": ["example project"],
    "urls": ["https://github.com/example/project"],
    "target_notes": []
  },
  "requested_outputs": ["curated Obsidian note", "email summary"],
  "required_capabilities": ["link_fetch", "summarization", "obsidian_write"],
  "prohibited_actions": ["account_login", "external_posting", "purchase"],
  "review_required": false,
  "classifier_version": "nanobot-classifier-0.1"
}
```

**State transition:** `sanitized → classified` or `sanitized → needs_review`.

**Validation:** Reject confidence outside `0..1`. Force `needs_review` when intent is `unknown`, confidence is below the configured threshold, required capability is unavailable, or a prohibited action is requested.

### 3.5 `POST /api/v1/transactions/{transaction_id}/plan`

**Purpose:** Submit a bounded execution plan after classification.

**Request:**

```json
{
  "route": "research_to_obsidian",
  "worker_type": "research",
  "permissions": ["fetch_public_url", "memory_read", "memory_write", "send_email"],
  "steps": [
    {"id": "fetch", "kind": "tool", "timeout_seconds": 60},
    {"id": "context", "kind": "memory_read", "timeout_seconds": 30},
    {"id": "summarize", "kind": "worker", "timeout_seconds": 300},
    {"id": "persist", "kind": "memory_write", "timeout_seconds": 60},
    {"id": "respond", "kind": "delivery", "timeout_seconds": 60}
  ],
  "expected_artifacts": ["obsidian_note", "email_response"]
}
```

**State transition:** `context_loaded → planned`.

The endpoint must reject a plan containing capabilities not permitted by classification or policy.

### 3.6 `POST /api/v1/transactions/{transaction_id}/steps/{step_id}/start`

**Purpose:** Acquire a step lease and mark a step as running.

**Request:**

```json
{
  "worker_id": "nanobot-01",
  "lease_seconds": 300,
  "attempt": 1,
  "input_hash": "sha256:..."
}
```

**Response:** `200` with lease details or `409` if another worker owns an active lease.

### 3.7 `POST /api/v1/transactions/{transaction_id}/steps/{step_id}/complete`

**Purpose:** Record a completed step and its artifact references.

**Request:**

```json
{
  "worker_id": "nanobot-01",
  "result": "success",
  "output_hash": "sha256:...",
  "artifacts": [
    {"type": "research_draft", "id": "artifact_123"}
  ],
  "metrics": {
    "latency_ms": 842,
    "tokens_in": 1200,
    "tokens_out": 800
  }
}
```

A completion request must be idempotent for the same `step_id`, `attempt`, and `output_hash`.

### 3.8 `POST /api/v1/transactions/{transaction_id}/steps/{step_id}/fail`

**Purpose:** Record a retryable or permanent step failure.

**Request:**

```json
{
  "worker_id": "nanobot-01",
  "error": {
    "code": "OBSIDIAN_WRITE_FAILED",
    "message": "MCP server unavailable",
    "retryable": true,
    "upstream": "obsidian-mind"
  },
  "retry_after_seconds": 30
}
```

### 3.9 `POST /api/v1/transactions/{transaction_id}/resume`

**Purpose:** Resume a transaction after review, retryable failure, or operator intervention.

**Request:**

```json
{
  "reason": "operator_approved",
  "review_answer": "Research only; do not modify the existing project note.",
  "resume_from": "classified"
}
```

The bridge must reject a resume request that would bypass a required policy gate or create an invalid state transition.

### 3.10 `POST /api/v1/transactions/{transaction_id}/cancel`

**Purpose:** Cancel queued or running work.

**Request:**

```json
{
  "reason": "user_requested",
  "cancel_running_step": true
}
```

Cancellation must be cooperative. It must not delete already-created durable notes or erase audit events.

## 4. OB1 session-state API

OB1 may be implemented as a database-backed repository rather than a public network service. If a service boundary is useful, expose only the following operations.

### 4.1 `PUT /api/v1/sessions/{transaction_id}`

Create or replace the current session-state projection using optimistic concurrency.

```json
{
  "state": "executing",
  "version": 7,
  "current_step": "summarize",
  "classification": {},
  "plan": {},
  "context": {
    "retrieved_note_ids": ["obs_existing_123"],
    "context_snapshot_hash": "sha256:..."
  },
  "artifacts": {},
  "attempts": {"total": 2, "by_step": {"fetch": 1, "summarize": 1}},
  "lease": {"worker_id": "nanobot-01", "expires_at": "2026-08-14T14:37:10Z"}
}
```

Require `If-Match: "7"` or an equivalent version field. Return `412` on stale updates.

### 4.2 `GET /api/v1/sessions/{transaction_id}`

Return the resumable checkpoint. This endpoint is used during process startup and before retrying any step.

### 4.3 `POST /api/v1/sessions/{transaction_id}/leases`

Acquire, renew, or release a transaction lease.

```json
{
  "operation": "acquire",
  "worker_id": "nanobot-01",
  "ttl_seconds": 300
}
```

### 4.4 `POST /api/v1/sessions/{transaction_id}/artifacts`

Register a draft, fetched-source archive, worker result, final-note reference, or delivery reference. The artifact record stores type, URI, content hash, producer, and retention class. The content itself should live in protected storage when it is large or sensitive.

## 5. obsidian-mind memory gateway

The repository’s documented MCP surfaces are the preferred memory interface: `search`, `expand`, `recall`, `remember`, `record_work`, and `health`, plus readable note resources [1]. The bridge should expose these as MCP tools to nanobot rather than making every worker know the vault filesystem.

### 5.1 MCP initialization

The nanobot MCP client must first perform the MCP initialization handshake and then discover tools. The bridge should verify the server identity, protocol compatibility, vault scope, and caller identity before allowing writes.

Conceptually:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "<negotiated-version>",
    "capabilities": {},
    "clientInfo": {"name": "nanobot-obsidian-bridge", "version": "0.1.0"}
  }
}
```

The exact negotiated MCP protocol version must come from the deployed server; do not hard-code an unverified version in the transaction contract.

### 5.2 `tools/list`

Discover available memory tools and their schemas. The bridge should require these logical capabilities even if the server exposes additional tools:

```text
search
read
expand
recall
remember
record_work
health
```

The bridge must maintain an allowlist. Discovery alone must not grant a newly appearing write-capable tool permission to execute.

### 5.3 `tools/call: health`

**Purpose:** Verify vault, MCP server, index, and scope health before context loading or persistence.

**Logical arguments:**

```json
{
  "include": ["vault", "index", "scope", "write_capability"]
}
```

**Required normalized response:**

```json
{
  "status": "healthy",
  "vault_id": "vault_primary",
  "readable": true,
  "writable": true,
  "index_status": "fresh",
  "scope": "user_content_roots"
}
```

### 5.4 `tools/call: search`

**Purpose:** Find relevant notes using semantic and keyword retrieval.

**Logical arguments:**

```json
{
  "query": "example project architecture",
  "limit": 8,
  "scope": {"projects": [], "platforms": []},
  "include_superseded": false,
  "explain": true
}
```

**Normalized response:**

```json
{
  "results": [
    {
      "note_id": "obs_123",
      "path": "Projects/Example/Architecture.md",
      "title": "Example Architecture",
      "excerpt": "...",
      "score": 0.87,
      "provenance": {"reason": "keyword_and_semantic_match"},
      "confidence": "verified",
      "updated_at": "2026-08-10T12:00:00Z"
    }
  ],
  "query": "example project architecture",
  "index_status": "fresh"
}
```

The bridge should store the returned note IDs and a context snapshot hash in OB1.

### 5.5 `resources/read` or logical `read`

**Purpose:** Read a selected canonical note after search.

**Logical arguments:**

```json
{
  "note_id": "obs_123",
  "path": "Projects/Example/Architecture.md",
  "max_chars": 20000
}
```

Require exactly one stable target, preferably `note_id` plus resolved path. Return content, front matter, links, revision or content hash, and scope metadata. Never permit a worker to read arbitrary filesystem paths outside the configured vault roots.

### 5.6 `tools/call: expand`

**Purpose:** Traverse links and backlinks around a known note.

```json
{
  "note_id": "obs_123",
  "direction": "both",
  "depth": 1,
  "limit": 30
}
```

Use this when graph neighborhood is needed. Do not use it as a replacement for the structural graph projection.

### 5.7 `tools/call: recall`

**Purpose:** Retrieve durable lessons scoped to the current project, platform, or caller.

```json
{
  "topic": "nanobot persistence",
  "project": "obsidian-world",
  "platform": null,
  "limit": 10,
  "explain": true
}
```

The bridge must pass an authenticated caller identity derived from the MCP roots handshake or service identity. A caller must not be allowed to widen scope by placing a broader project name in arguments.

### 5.8 `tools/call: remember`

**Purpose:** Record a durable lesson or correction in the vault.

```json
{
  "title": "Nanobot persistence must remain behind the transaction wrapper",
  "content": "Durable writes are validated by the bridge and committed to Obsidian.",
  "scope": "project",
  "projects": ["obsidian-world"],
  "platforms": [],
  "confidence": "verified",
  "source_transaction_id": "txn_20260814_8f3d1a2c",
  "supersedes": []
}
```

This operation should be available only to the `memory_write` capability. It must return the created note ID, path, revision, and whether the operation created or superseded a prior memory.

### 5.9 `tools/call: record_work`

**Purpose:** Record a durable, human-meaningful work outcome in the correct vault location.

```json
{
  "title": "Nanobot and obsidian-mind bridge decision",
  "folder": "Decisions",
  "content": "...",
  "tags": ["architecture", "nanobot", "obsidian-world"],
  "related_note_ids": ["obs_123"],
  "source_transaction_id": "txn_20260814_8f3d1a2c"
}
```

The adapter should validate the requested destination against the vault’s exposed roots and return the canonical path. It must not allow a worker to select arbitrary destinations outside policy.

### 5.10 Controlled canonical write adapter

Because the documented obsidian-mind surfaces may evolve, implement a bridge-owned logical operation named `durable_note.upsert` even if it internally calls `remember`, `record_work`, or another MCP tool.

**Logical request:**

```json
{
  "operation": "create",
  "note": {
    "idempotency_key": "note:txn_20260814_8f3d1a2c:research",
    "title": "Example Project — Research Summary",
    "type": "research",
    "folder": "Research",
    "front_matter": {
      "transaction_id": "txn_20260814_8f3d1a2c",
      "canonical": true,
      "confidence": "medium",
      "source_urls": ["https://github.com/example/project"]
    },
    "body_markdown": "# Example Project — Research Summary\n..."
  },
  "expected_revision": null
}
```

**Response:**

```json
{
  "note_id": "obs_01J5NANOBOT8F3D1A2C",
  "path": "Research/Example Project — Research Summary.md",
  "operation": "created",
  "revision": "sha256:...",
  "transaction_id": "txn_20260814_8f3d1a2c"
}
```

This is the most important write boundary in the system. It must validate front matter, prevent duplicate creation, preserve supersession links, and record the transaction ID.

## 6. Worker API

Workers should not receive raw access to every nanobot tool. Use a bounded task API.

### 6.1 `POST /api/v1/worker-tasks`

```json
{
  "transaction_id": "txn_20260814_8f3d1a2c",
  "step_id": "summarize",
  "worker_type": "research",
  "objective": "Produce a concise, source-grounded research summary.",
  "context": {
    "note_ids": ["obs_123"],
    "source_artifacts": ["artifact_source_456"]
  },
  "permissions": ["memory_read", "fetch_public_url"],
  "output_schema": "research_result.v1",
  "deadline_seconds": 300
}
```

### 6.2 `POST /api/v1/worker-tasks/{task_id}/result`

```json
{
  "status": "completed",
  "result": {
    "summary": "...",
    "findings": [],
    "sources": [],
    "open_questions": [],
    "recommended_next_step": null
  },
  "output_hash": "sha256:...",
  "worker": {"name": "claude-code", "version": "..."}
}
```

A worker result is a proposed artifact. It does not itself create canonical memory. The bridge must validate and persist it through `durable_note.upsert`.

## 7. Delivery API

### 7.1 `POST /api/v1/deliveries`

```json
{
  "transaction_id": "txn_20260814_8f3d1a2c",
  "idempotency_key": "reply:message_abc123:v1",
  "channel": "email",
  "to": ["user@example.com"],
  "in_reply_to": "message_abc123",
  "subject": "Completed: Example Project research",
  "body_text": "Completed. ...",
  "references": [
    {"type": "obsidian_note", "note_id": "obs_123", "path": "Research/Example Project — Research Summary.md"}
  ]
}
```

**Response:** `202` when queued, `200` when already delivered, or `502`/`503` for temporary provider failure.

### 7.2 `GET /api/v1/deliveries/{delivery_id}`

Return `queued`, `sending`, `sent`, `failed_retryable`, `failed_permanent`, or `unknown_delivery_state`.

When state is `unknown_delivery_state`, the bridge must not rerun processing. It should retry only through the provider’s idempotency mechanism or enter review.

## 8. Health and observability endpoints

### 8.1 `GET /api/v1/health/live`

Process liveness only. It must not call external providers.

### 8.2 `GET /api/v1/health/ready`

Readiness for accepting new transactions. Check OB1 connectivity, nanobot channel readiness, and required memory-service availability.

### 8.3 `GET /api/v1/health/dependencies`

Return component-level status:

```json
{
  "nanobot": {"status": "healthy", "version": "0.2.1"},
  "ob1": {"status": "healthy"},
  "obsidian_mind": {"status": "healthy", "readable": true, "writable": true},
  "email_provider": {"status": "degraded", "reason": "rate_limited"},
  "rag": {"status": "stale", "last_indexed_at": "..."}
}
```

### 8.4 `GET /api/v1/metrics`

Expose counters and latency summaries for transactions received, duplicate deliveries, state transitions, step retries, Obsidian reads/writes, MCP errors, worker failures, and delivery outcomes. Do not expose message bodies or secrets.

## 9. Authentication and capability model

Use service-to-service authentication for the first deployment. At minimum, define separate credentials for the nanobot adapter, worker adapter, Omni-console, and operator tools. Authorization should be capability-based rather than endpoint-only.

| Capability | Allowed operations |
|---|---|
| `transaction_read` | Get transactions, events, sessions, health |
| `transaction_control` | Classify, plan, resume, cancel, acquire leases |
| `memory_read` | Health, search, read, expand, recall |
| `memory_write` | Remember, record work, durable-note upsert |
| `worker_execute` | Create tasks and submit results |
| `delivery_send` | Queue and inspect outbound responses |
| `operator_admin` | Override review, cancel, replay, rotate leases |

A worker should normally receive `memory_read` but not `memory_write`. The transaction layer receives `memory_write` after validating the worker artifact. Account actions, purchases, external posting, and login must be separate capabilities and disabled in the first slice.

## 10. Minimal first-slice endpoint set

The first implementation does not need the entire surface. Build these endpoints first:

| Priority | Endpoint or operation | Why it is required |
|---|---|---|
| P0 | `POST /intake/messages` | Create one normalized transaction from email |
| P0 | `GET /transactions/{id}` | Observe state and resume after restart |
| P0 | `PUT /sessions/{id}` / `GET /sessions/{id}` | Store and recover OB1 checkpoints |
| P0 | MCP `health` | Verify vault access before work |
| P0 | MCP `search` + `read` | Load existing Obsidian context |
| P0 | Logical `durable_note.upsert` | Create one validated canonical note |
| P0 | `POST /deliveries` | Return the result idempotently by email |
| P0 | `POST /steps/{step}/start|complete|fail` | Make retries and restarts safe |
| P1 | MCP `expand` + `recall` | Improve context navigation and scoped lessons |
| P1 | `POST /worker-tasks` + result callback | Standardize interchangeable workers |
| P1 | `GET /transactions/{id}/events` | Improve debugging and dashboard visibility |
| P2 | MCP `remember` + `record_work` | Add richer durable lessons and work records |
| P2 | `resume` / `cancel` operator controls | Support human intervention paths |
| P2 | Metrics and dependency health | Production monitoring |

## 11. Example end-to-end call sequence

```text
1. Email adapter → POST /api/v1/intake/messages
2. Bridge → PUT /api/v1/sessions/{transaction_id} [received]
3. Bridge → POST /api/v1/transactions/{id}/classify
4. Bridge → PUT /api/v1/sessions/{id} [classified]
5. Nanobot tool client → MCP health
6. Nanobot tool client → MCP search
7. Nanobot tool client → MCP read
8. Bridge → POST /api/v1/transactions/{id}/plan
9. Bridge → POST /api/v1/transactions/{id}/steps/context/start
10. Bridge → POST /api/v1/transactions/{id}/steps/context/complete
11. Bridge → POST /api/v1/worker-tasks
12. Worker → POST /api/v1/worker-tasks/{task_id}/result
13. Bridge → durable_note.upsert via controlled MCP write
14. Bridge → PUT /api/v1/sessions/{id} [persisted]
15. Bridge → POST /api/v1/deliveries
16. Bridge → PUT /api/v1/sessions/{id} [completed]
17. Bridge → append terminal event
```

## 12. Design constraints

The bridge must not expose direct filesystem writes to arbitrary workers, use the RAG index as canonical memory, store transient OB1 state in Obsidian, or let a model select an unapproved tool merely because it appears in MCP discovery. Every durable write must be attributable to a transaction, every mutation must be idempotent, and every uncertain external side effect must become visible to a human operator.

## References

[1]: https://github.com/breferrari/obsidian-mind "breferrari/obsidian-mind repository; documented MCP surfaces and vault-first memory model"
[2]: https://github.com/HKUDS/nanobot "HKUDS/nanobot repository; runtime, channels, tools, MCP, memory, routing, and automation baseline"
