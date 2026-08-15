# Migration from the nanobot transaction specification to MAMA core

**Status:** Proposed migration baseline  
**Principle:** Migrate meanings and provenance, not merely table rows. Preserve the original transaction identity, state history, artifacts, and durable-note links while moving operational memory into MAMA-native structures.

## 1. Target data model

MAMA’s documented operational memory includes decisions, embeddings, scopes, provenance, graph edges, truth projection, temporal metadata, channel summaries, audit records, and effect tracking [1] [2]. The migration should map the proposed transaction specification into those concepts without pretending that a transaction is itself a durable human memory.

| Source concept | Target MAMA concept | Migration treatment |
|---|---|---|
| `transaction_id` | `source_event_id`, workorder/run correlation, effect correlation | Preserve as immutable external correlation; never replace it with a generated memory ID |
| Inbound email/message | Channel event or channel summary input | Store provider ID, thread ID, sender/channel scope, timestamps, and content hash; retain raw body only by policy |
| Classification | Workorder/trigger judgment metadata | Store route, confidence, policy decision, required capabilities, and review requirement |
| Step state | Checkpoint/workorder/task state | Store current state, attempt, lease, worker, input hash, output hash, and timestamps |
| OB1 session state | MAMA session/workorder/checkpoint records | Move ephemeral state into MAMA operational stores; do not write checkpoints into durable Markdown memory |
| Worker result | Artifact/evidence record plus optional candidate memories | Keep the result as an artifact; promote only validated findings into MAMA memory |
| `mamaMemoryIds` | `decisions` or typed memory units | Create only for durable, scoped findings; attach source transaction and provenance |
| Obsidian note | Durable Markdown projection/source record | Preserve path, note ID, content hash, revision, and transaction link |
| State transition events | `memory_events`, workorder audit, or append-only transaction event stream | Preserve all events; do not collapse history into final state only |
| Durable write | MAMA `saveMemory`/writer path plus evidence-effect ledger | Make MAMA the committing authority and record the resulting effect |
| Outbound delivery | Effect ledger and channel delivery receipt | Preserve provider message ID, idempotency key, status, and uncertain-effect state |
| `supersedes` / `builds_on` | MAMA graph edges | Translate only when the relationship is semantically supported |
| Retrieval context | Recall bundle with scope and provenance | Recompute or import as a context snapshot; never treat retrieved context as new truth automatically |

## 2. Migration phases

### Phase 1 — Inventory and freeze

Freeze the source transaction schema at a numbered version. Export all source transactions, sessions, artifacts, events, and note links into immutable JSONL or SQLite staging tables. Record the export timestamp, source schema version, and source database content hash.

Create a migration manifest:

```json
{
  "migration_id": "mig_20260815_nanobot_mama_v1",
  "source_schema": "obsidian_world_transaction_v1",
  "target_schema": "mama-core-operational-memory",
  "source_export_hash": "sha256:...",
  "started_at": "2026-08-15T00:00:00Z",
  "dry_run": true
}
```

Do not start live writes until the dry run has produced counts and rejected-row reports.

### Phase 2 — Normalize identities and timestamps

For every source transaction, normalize:

| Field | Rule |
|---|---|
| `transaction_id` | Preserve exactly; if missing, create `legacy_txn_<source-row-id>` and flag it |
| Provider message ID | Preserve provider namespace, for example `gmail:message_abc123` |
| Event time | Store original occurrence time as event date/time |
| Ingest time | Store the migration or intake time separately |
| Channel | Convert to MAMA’s canonical channel key |
| Scope | Derive `project`, `channel`, `user`, or `global`; ambiguous scope becomes `needs_review` |
| Content | Compute a content hash before truncation or redaction |
| Secrets | Redact from searchable memory and store only a redaction record |

This step is essential because MAMA distinguishes event time from ingestion time and uses canonical channel identities for scoped recall [2].

### Phase 3 — Load source events and transaction correlations

Create a correlation table or MAMA-compatible event projection with:

```text
source_event_id
source_system = "obsidian_world"
source_record_type = "inbound|classification|step|artifact|delivery"
source_record_id
transaction_id
channel_key
occurred_at
ingested_at
content_hash
payload_uri
redaction_status
```

Every later memory, effect, and workorder record should be able to point back to this correlation. If MAMA’s current event schema does not have a direct `source_system` field, place the source identity in its supported provenance or correlation metadata rather than adding an untracked parallel table.

### Phase 4 — Convert transactions into MAMA workorders and checkpoints

For each non-terminal source transaction:

1. Create or reconcile a MAMA workorder/run with `transaction_id` as the external correlation.
2. Translate the current state into the nearest MAMA lifecycle state.
3. Import the last completed step, input hash, output hash, worker ID, attempt count, lease expiry, and next action.
4. Mark ambiguous or partially migrated side effects as `needs_review`.
5. Do not replay completed memory writes or deliveries merely because the workorder was imported.

Suggested status mapping:

| Source state | MAMA target state |
|---|---|
| `received`, `sanitized` | `queued` / `pending` |
| `classified`, `context_loaded`, `planned` | `ready` / `planned` |
| `executing` | `running` with imported checkpoint |
| `persisting` | `reconcile_required` unless the write receipt is verified |
| `responding` | `delivery_reconcile_required` |
| `completed` | `done` with imported effects |
| `needs_review` | `approval_required` |
| `failed` | `failed` with retry policy preserved |

### Phase 5 — Promote validated worker findings into MAMA core

Do not migrate every worker draft as a permanent memory. Apply a promotion predicate:

```text
promote if:
  result is schema-valid
  AND result has source evidence or an explicit unattributed marker
  AND scope is resolved
  AND content is not a duplicate of current truth
  AND no secret or prohibited payload is present
  AND a transaction effect can be recorded
```

For promoted findings, call MAMA’s supported memory writer path. Store typed memory such as `decision`, `fact`, `lesson`, `constraint`, or `preference` according to the meaning of the finding. Attach:

```text
source_transaction_id
source_event_ids
source_urls or note IDs
scope bindings
event_date
provenance status
content hash
```

Preserve the original worker result as an artifact or archive reference rather than replacing it with the promoted memory.

### Phase 6 — Reconcile Obsidian notes

For each source note:

1. Resolve the canonical path and note ID.
2. Compute the current Markdown content hash.
3. Match the source transaction and MAMA memory IDs using front matter or the migration manifest.
4. If the note is unchanged, register the existing projection.
5. If the note differs, create a review record; never overwrite human edits during bulk migration.
6. Add or preserve transaction metadata only through a controlled projection migration.

Recommended front matter for migrated notes:

```yaml
transaction_id: txn_20260814_8f3d1a2c
mama_memory_ids:
  - mem_123
migration_id: mig_20260815_nanobot_mama_v1
canonical_projection: true
content_hash: sha256:...
provenance_status: verified
```

### Phase 7 — Import graph relationships and truth history

Translate only explicit source relationships. A source note or worker result that says “replaces” may become `supersedes`; a result that extends an earlier decision may become `builds_on`. Do not infer graph edges solely from similar titles.

Preserve superseded historical records rather than deleting them. MAMA’s truth projection should surface the current truth while retaining the evolution chain for audit and temporal questions [2].

### Phase 8 — Import effects and deliveries

Create effect records for:

| Effect | Required receipt |
|---|---|
| MAMA memory save | memory ID, revision/content hash, source transaction ID |
| Obsidian write | note ID/path, content hash, revision or filesystem receipt |
| Email/message send | provider message ID or explicit unknown state |
| Worker execution | worker ID, task ID, attempt, output hash |
| Review decision | reviewer identity, decision, timestamp, scope |

If the source says “sent” without a provider receipt, import the effect as `unknown_delivery_state` and require reconciliation. Never resend automatically during migration.

### Phase 9 — Dual-read verification

For a representative sample, compare:

| Verification | Required result |
|---|---|
| Transaction count | Source and target counts reconcile, excluding documented rejects |
| Event count | Every source event has a target correlation or rejection reason |
| Memory count | Every promoted memory has provenance and scope |
| Retrieval | Queries return the same or better relevant current truths |
| Supersession | Current and historical truth agree with source semantics |
| Obsidian links | Every migrated note resolves to a valid path and transaction |
| Delivery | No outbound message is resent during verification |
| Restart | Imported running workorders resume from the imported checkpoint |

### Phase 10 — Cutover and decommission

Cut over intake to MAMA OS only after the MAMA-native vertical slice passes duplicate, restart, timeout, and ambiguous-effect tests. Mark the old transaction system read-only. Keep the source export and rejected-row report for rollback and audit. Disable nanobot’s scheduler, memory writer, and outbound delivery in the MAMA-centered deployment; retain only the bounded adapter endpoint.

## 3. Data-quality and conflict rules

| Conflict | Resolution |
|---|---|
| Same provider message appears under two transaction IDs | Choose the earliest verified idempotency key; link the other transaction as duplicate |
| Two notes claim the same canonical memory | Preserve both, create a review conflict, and do not auto-supersede |
| Source says completed but effect receipt is absent | Import as completed-with-unknown-effect and require review |
| Scope cannot be derived | Import to quarantine scope; block promotion to global memory |
| Worker draft contains secrets | Redact and retain only secure archive metadata |
| MAMA memory already exists | Match by content hash and provenance before creating a duplicate |
| Obsidian note was edited after export | Preserve current human edit; create a migration conflict record |
| Source checkpoint is older than a live MAMA checkpoint | Do not overwrite live state; import as historical evidence |

## 4. Migration acceptance criteria

The migration is accepted only when MAMA OS can start as the sole daemon, process a new inbound message, create one transaction/workorder, recall scoped MAMA memory, optionally read Obsidian context, dispatch one nanobot task, validate the result, save one MAMA memory, project one Obsidian note, deliver one response, and recover safely after a forced restart.

A successful migration is therefore not “all rows copied.” It is **all authority boundaries made explicit and one complete transaction proven under MAMA ownership**.

## References

[1]: https://github.com/jungjaehoon-lifegamez/MAMA "MAMA OS repository README and package architecture"
[2]: https://raw.githubusercontent.com/jungjaehoon-lifegamez/MAMA/main/CLAUDE.md "MAMA engineering guide: memory schema, scopes, provenance, graph edges, event time, checkpoints, and evidence/effects"
[3]: https://github.com/HKUDS/nanobot "Nanobot runtime baseline and bounded worker adapter source"
