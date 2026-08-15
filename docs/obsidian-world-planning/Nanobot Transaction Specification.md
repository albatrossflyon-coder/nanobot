# Nanobot Transaction Specification

**Version:** 0.1  
**Status:** Final implementation baseline  
**Author:** Manus AI  
**Scope:** Phone/email intake through classification, Obsidian persistence, session-state updates, and email response.

## 1. Purpose and architectural boundary

This specification defines the smallest reliable transaction that turns an inbound request into a durable, human-readable result. Nanobot is the coordinator. Obsidian is the canonical store for durable knowledge. OB1 is the store for ephemeral execution and session state. Retrieval, research, and coding agents are subordinate services invoked by nanobot when the classification requires them.

The transaction must be independently retryable, observable, and safe to resume after a process restart. No component other than the approved Obsidian writer may silently create canonical knowledge, and transient execution details must not be written into the vault merely because they are available during processing.

## 2. Transaction definition

A transaction begins when nanobot accepts a new inbound message and ends when one of the following terminal outcomes is recorded:

| Outcome | Meaning |
|---|---|
| `completed` | The request was processed and the requested response was sent or queued for delivery. |
| `completed_with_warnings` | The main result was produced, but a non-critical step such as indexing or enrichment failed. |
| `needs_review` | The request is understood enough to preserve safely, but a human decision is required before execution or publication. |
| `failed_retryable` | Processing failed for a temporary reason and may be retried automatically. |
| `failed_permanent` | Processing failed because the request or configuration is invalid and requires correction. |
| `cancelled` | Processing was intentionally stopped by the user or operator. |

The transaction identifier is immutable and must be present in every log record, OB1 state record, generated note front matter, and outbound response metadata.

## 3. Inbound input format

Email is the first transport. The transport adapter must normalize provider-specific fields into a provider-neutral envelope before classification. The message body may be plain text or HTML; the normalized representation must preserve the original message as an attachment or raw archive reference while exposing a sanitized text version to downstream agents.

### 3.1 Normalized inbound envelope

```json
{
  "transaction_id": "txn_20260814_8f3d1a2c",
  "idempotency_key": "email:gmail:message_abc123",
  "received_at": "2026-08-14T14:30:00Z",
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
    "display_name": "Chris",
    "is_authorized": true
  },
  "recipients": ["nanobot@example.com"],
  "subject": "Research this GitHub project",
  "body": {
    "text": "Please investigate https://github.com/example/project and save the important findings.",
    "html_present": true,
    "attachments": []
  },
  "links": [
    {
      "url": "https://github.com/example/project",
      "label": null,
      "source": "body"
    }
  ],
  "user_directives": {
    "requested_action": null,
    "requested_project": null,
    "requested_tags": [],
    "urgency": "normal",
    "reply_requested": true
  },
  "security": {
    "authentication_result": "passed",
    "content_sanitized": true,
    "attachment_scan": "not_applicable"
  }
}
```

### 3.2 Input normalization rules

The adapter must reject messages from unauthorized senders unless an explicit operator override exists. It must preserve the original provider message identifier and use it as part of the idempotency key. Subject and body text should be trimmed, decoded, and normalized without changing the original archive. URLs must be extracted into a separate list, deduplicated, and retained in original order. Attachments should receive stable identifiers and must not be executed merely because they are attached.

The following fields are required: `transaction_id`, `idempotency_key`, `received_at`, `source.channel`, `source.message_id`, `sender.email`, `body.text`, and `security.authentication_result`. If the body is empty, the request may still proceed as `needs_review` when it contains a usable attachment or link; otherwise it is `failed_permanent` with error code `EMPTY_REQUEST`.

## 4. Classification model

Classification is a routing decision, not a final answer. The classifier must produce a structured result with a confidence score, explicit evidence, and a proposed route. Low-confidence or conflicting classifications must be routed to review rather than silently executed.

### 4.1 Classification states

| State | Purpose | Allowed next states |
|---|---|---|
| `received` | Envelope accepted and idempotency checked. | `sanitized`, `failed_permanent`, `cancelled` |
| `sanitized` | Message normalized and safety checks completed. | `classified`, `needs_review`, `failed_permanent` |
| `classified` | Intent and route selected. | `context_loaded`, `needs_review`, `cancelled` |
| `context_loaded` | Relevant Obsidian and session context retrieved. | `planned`, `needs_review`, `failed_retryable` |
| `planned` | Work plan and tool permissions determined. | `executing`, `needs_review`, `cancelled` |
| `executing` | Research, transformation, or agent work is in progress. | `persisting`, `needs_review`, `failed_retryable`, `failed_permanent`, `cancelled` |
| `persisting` | Durable note and session state are being written. | `responding`, `completed_with_warnings`, `failed_retryable`, `failed_permanent` |
| `responding` | Outbound email is being prepared or delivered. | `completed`, `completed_with_warnings`, `failed_retryable` |
| `needs_review` | Human input is required before continuing. | `classified`, `planned`, `cancelled` |
| `failed_retryable` | Temporary error recorded. | `received`, `context_loaded`, `executing`, `persisting`, `responding`, `failed_permanent`, `cancelled` |
| `failed_permanent` | Irrecoverable error recorded. | `cancelled` |
| `cancelled` | Processing intentionally stopped. | None |
| `completed` | Full transaction succeeded. | None |
| `completed_with_warnings` | Main result succeeded with non-critical degradation. | None |

### 4.2 Supported intent classes

The first implementation should support a deliberately small set of intent classes:

| Intent | Typical request | Default route |
|---|---|---|
| `capture` | Save this link, idea, or note. | Normalize, create or update an Obsidian note, reply with location. |
| `research` | Investigate a link, topic, paper, or project. | Retrieve existing context, research if needed, create a curated note, reply with findings. |
| `question` | Answer a question using existing knowledge. | Retrieve Obsidian context, answer, optionally create a decision or fact note when requested. |
| `task` | Perform a bounded action or delegate work. | Create a task record, select worker, execute only approved actions, report status. |
| `update` | Modify an existing project, note, or decision. | Resolve target note, propose or apply a controlled update, record change history. |
| `status` | Ask what nanobot or an existing task is doing. | Read OB1 and service health; do not invoke research by default. |
| `unknown` | Intent cannot be assigned safely. | Ask a clarifying question and enter `needs_review`. |

### 4.3 Classification result schema

```json
{
  "transaction_id": "txn_20260814_8f3d1a2c",
  "intent": "research",
  "confidence": 0.94,
  "route": "research_to_obsidian",
  "priority": "normal",
  "entities": {
    "topics": ["example project"],
    "urls": ["https://github.com/example/project"],
    "target_notes": [],
    "project": null
  },
  "requested_outputs": ["curated Obsidian note", "email summary"],
  "required_capabilities": ["link_fetch", "summarization", "obsidian_write"],
  "prohibited_actions": ["account_login", "external_posting", "purchase"],
  "evidence": [
    "The sender explicitly asked for investigation.",
    "A GitHub URL is present."
  ],
  "review_required": false,
  "classifier_version": "nanobot-classifier-0.1",
  "classified_at": "2026-08-14T14:30:04Z"
}
```

A route may not grant permissions that were not requested or explicitly configured. For example, a request to research a website does not authorize login, posting, purchasing, or account changes. Any action involving external accounts must be classified as `needs_review` unless an explicit, pre-approved policy covers it.

## 5. Obsidian durable-note schema

Obsidian is the canonical durable store. Notes must remain useful when read without nanobot, RAG, OB1, or any other service. The note body is Markdown, while the front matter carries machine-readable identity and indexing metadata.

### 5.1 Required front matter

```yaml
---
id: obs_01J5NANOBOT8F3D1A2C
transaction_id: txn_20260814_8f3d1a2c
title: Example Project — Research Summary
type: research
status: active
created_at: 2026-08-14T14:35:00Z
updated_at: 2026-08-14T14:35:00Z
source_urls:
  - https://github.com/example/project
source_message_id: message_abc123
projects: []
tags:
  - research
  - github
  - nanobot-created
confidence: medium
canonical: true
supersedes: null
related_notes: []
last_transaction: txn_20260814_8f3d1a2c
---
```

### 5.2 Note body contract

Every generated note must contain the following headings in this order:

```markdown
# Example Project — Research Summary

## Executive summary

A concise, human-readable summary of the durable finding.

## Why it matters

The relevance to the user's project, decision, or knowledge base.

## Findings

- Finding one, with source context.
- Finding two, with source context.

## Evidence and sources

- [Project repository](https://github.com/example/project) — accessed 2026-08-14.

## Open questions

Questions that remain unresolved or require human judgment.

## Recommended next step

A bounded next action, if one is justified.

## Transaction metadata

Created from transaction `txn_20260814_8f3d1a2c`.
```

If a matching canonical note already exists, nanobot must update it only when the classification explicitly indicates `update` or when the capture policy permits append-only enrichment. Otherwise it must create a new note and link the related note rather than overwriting prior knowledge. Every update must preserve prior content through a change record or Git history.

### 5.3 Note path convention

Use predictable, human-readable paths:

```text
Inbox/                 # Unclassified or awaiting review
Research/              # Curated research notes
Projects/<project>/    # Project-specific durable knowledge
Decisions/             # Explicit decisions and rationale
Tasks/                 # Durable task definitions and outcomes
Archive/               # Superseded or retired notes
```

A note may enter `Inbox/` when review is required. It should be moved to its canonical folder only after classification and persistence succeed.

## 6. OB1 session-state schema

OB1 stores transient execution state and should be safe to delete or rebuild without destroying durable knowledge. It must contain enough information to resume an interrupted transaction without duplicating external effects.

```json
{
  "transaction_id": "txn_20260814_8f3d1a2c",
  "status": "executing",
  "state": "executing",
  "created_at": "2026-08-14T14:30:00Z",
  "updated_at": "2026-08-14T14:32:10Z",
  "source": {
    "channel": "email",
    "message_id": "message_abc123",
    "thread_id": "thread_xyz789"
  },
  "classification": {
    "intent": "research",
    "route": "research_to_obsidian",
    "confidence": 0.94,
    "classifier_version": "nanobot-classifier-0.1"
  },
  "plan": {
    "steps": [
      {"id": "fetch", "status": "completed"},
      {"id": "summarize", "status": "running"},
      {"id": "persist", "status": "pending"},
      {"id": "respond", "status": "pending"}
    ],
    "current_step": "summarize"
  },
  "artifacts": {
    "input_archive_uri": "archive://email/message_abc123",
    "draft_note_id": null,
    "final_note_id": null,
    "response_id": null
  },
  "context": {
    "retrieved_note_ids": ["obs_existing_123"],
    "retrieval_query": "example project",
    "context_snapshot_hash": "sha256:..."
  },
  "attempts": {
    "total": 1,
    "by_step": {"fetch": 1, "summarize": 1, "persist": 0, "respond": 0}
  },
  "lease": {
    "worker_id": "nanobot-01",
    "expires_at": "2026-08-14T14:37:10Z"
  },
  "errors": [],
  "resume_token": "opaque-resume-token"
}
```

OB1 should retain completed transaction state for a configurable period, such as 30 days, and retain a compact audit reference thereafter. The exact retention period is an operational setting, not part of the durable knowledge model.

## 7. Transaction event schema

Each state transition must emit an append-only event. Events support debugging, replay analysis, and operational dashboards without turning Obsidian into a log database.

```json
{
  "event_id": "evt_01J5NANOBOTXYZ",
  "transaction_id": "txn_20260814_8f3d1a2c",
  "occurred_at": "2026-08-14T14:32:10Z",
  "from_state": "context_loaded",
  "to_state": "planned",
  "actor": "nanobot",
  "actor_version": "nanobot-0.1.0",
  "step": "planning",
  "result": "success",
  "latency_ms": 842,
  "metadata": {
    "retrieved_notes": 1,
    "tools_selected": ["link_fetch", "obsidian_write"]
  },
  "error": null
}
```

Events must not contain secrets, access tokens, full private message bodies, or unnecessary personal data. Sensitive raw content belongs in the protected input archive, referenced by URI.

## 8. Idempotency and duplicate handling

The idempotency key is derived from the source channel, provider account, and provider message identifier. A duplicate delivery with the same key must return the existing transaction status rather than create a second note or send a second response.

The persistence step must also use a deterministic note identity derived from the transaction and intended canonical target. Before writing, nanobot must check whether the transaction has already produced a final note. The response step must use an outbound delivery key such as `reply:<source_message_id>:<response_version>` so a timeout after sending cannot cause an accidental duplicate reply.

## 9. Retry and failure policy

Retries are permitted only for transient failures, including network timeouts, temporary provider errors, rate limits, and recoverable service unavailability. Each retry must use bounded exponential backoff with jitter and must increment the step attempt counter. Authentication failures, malformed input, unauthorized actions, schema violations, and unsupported capabilities are permanent failures unless corrected by a human.

| Error class | Example code | Default behavior |
|---|---|---|
| Input | `EMPTY_REQUEST`, `INVALID_ENCODING` | `failed_permanent` or `needs_review` |
| Authorization | `SENDER_NOT_ALLOWED`, `ACTION_NOT_APPROVED` | `needs_review` or `failed_permanent` |
| Duplicate | `DUPLICATE_MESSAGE` | Return existing transaction; no new work |
| Provider temporary | `EMAIL_TIMEOUT`, `RAG_UNAVAILABLE` | Retry current step |
| Model compatibility | `THOUGHT_SIGNATURE_INVALID` | Retry only if the adapter can repair; otherwise `failed_retryable` with operator alert |
| Persistence | `OBSIDIAN_WRITE_FAILED` | Retry without re-running expensive research |
| Delivery | `REPLY_SEND_FAILED` | Retry delivery only; do not repeat processing |
| Schema | `INVALID_NOTE_SCHEMA`, `INVALID_STATE_TRANSITION` | Halt and alert; do not overwrite data |

A transaction must never retry an unsafe external action automatically. If a worker has uncertain knowledge of whether an external side effect occurred, it must enter `needs_review` and expose the ambiguity to the operator.

## 10. Response contract

### 10.1 Success response

The normal email response should be concise and include the outcome, durable note location, transaction identifier, and any warnings.

```text
Subject: Completed: Example Project research

Completed.

I reviewed the requested source and saved the durable result here:
Obsidian: Research/Example Project — Research Summary.md

Transaction: txn_20260814_8f3d1a2c

Warnings: none
```

### 10.2 Review response

```text
Subject: Review needed: Example Project request

I received the request but need your decision before continuing.

Question: Should I only research and summarize the source, or should I also modify an existing project note?

Reply with your decision to resume transaction txn_20260814_8f3d1a2c.
```

### 10.3 Failure response

```text
Subject: Could not complete: Example Project request

Nanobot could not complete the request.

Stage: Obsidian persistence
Reason: OBSIDIAN_WRITE_FAILED
Transaction: txn_20260814_8f3d1a2c

The work was not discarded. It is safe to retry after the storage issue is resolved.
```

The response must distinguish between “not attempted,” “partially completed,” and “completed but response delivery uncertain.” When delivery itself fails, the transaction must remain internally terminal or resumable according to the delivery record; processing must not be repeated merely because email delivery was unavailable.

## 11. Minimal transaction algorithm

```text
1. Receive provider message.
2. Derive idempotency key and return existing status if already processed.
3. Create transaction in `received` state.
4. Authenticate sender, archive raw input, sanitize and normalize content.
5. Classify intent, confidence, entities, route, and prohibited actions.
6. Enter `needs_review` when confidence is low, intent is unknown, or a requested action is not pre-approved.
7. Retrieve relevant Obsidian context and current OB1 context.
8. Build a bounded execution plan.
9. Execute approved read/research/transformation steps.
10. Validate the generated result against the Obsidian note schema.
11. Persist the durable note idempotently.
12. Update OB1 with final session status and artifact references.
13. Prepare and send the response idempotently.
14. Emit terminal event and expose metrics, warnings, and transaction location.
```

## 12. Acceptance tests for version 0.1

| Test | Expected result |
|---|---|
| New research email with one URL | Creates one research note, updates OB1, sends one reply. |
| Same email delivered twice | Produces one transaction, one note, and one reply. |
| Empty email | Enters review or permanent failure with `EMPTY_REQUEST`; no fabricated note. |
| Unknown intent | Asks a clarifying question; no external work is performed. |
| Existing related note | Preserves the existing note unless update authority is explicit. |
| RAG unavailable | Uses another approved path or completes with warning; Obsidian remains canonical. |
| Obsidian write timeout | Retries persistence only; does not repeat research unnecessarily. |
| Reply timeout after successful write | Retries delivery only; does not create another note. |
| Unauthorized sender | Rejects or quarantines the request according to policy. |
| Process restart during execution | Resumes from OB1 checkpoint without duplicating completed side effects. |
| Model thought-signature error | Records the exact stage and error; applies adapter repair or enters retryable failure. |
| Request to post, purchase, log in, or change an account | Requires explicit review unless a separate approved policy exists. |

## 13. Versioning rules

Schemas must carry explicit versions. Additive fields are backward-compatible when consumers ignore unknown fields. Renaming fields, changing state semantics, changing note identity rules, or changing idempotency behavior requires a new schema version and a migration plan. Durable Obsidian notes should remain readable even when their originating nanobot version is retired.

The recommended first implementation is intentionally narrow: email intake, one classifier, Obsidian read/write, OB1 checkpoints, one research or capture worker, and email response. Additional agents and external action systems should be integrated only by adding a new route with explicit permissions, schemas, and acceptance tests.

## 14. Design basis and references

This specification is a system-design artifact derived from the provided Obsidian World architecture recommendation. It does not depend on external factual claims or third-party documentation; implementation-specific provider behavior should be validated against the selected email, Obsidian, and model APIs before deployment.
