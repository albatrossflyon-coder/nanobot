/*
 * Reference MAMA OS task loop.
 *
 * Ownership rule:
 *   MAMA owns intake, transaction identity, leases, policy, memory writes,
 *   Obsidian projection, and outbound delivery.
 *   Nanobot receives one bounded task and returns one typed result.
 *
 * This is a reference adapter. Translate repository-specific MAMA interfaces
 * before compiling against the current MAMA OS release.
 */

type TransactionState =
  | "received"
  | "sanitized"
  | "classified"
  | "context_loaded"
  | "planned"
  | "executing"
  | "validating"
  | "persisting"
  | "responding"
  | "completed"
  | "needs_review"
  | "failed";

type Capability =
  | "memory_read"
  | "public_url_fetch"
  | "worker_execute"
  | "memory_write_local"
  | "memory_write_obsidian"
  | "external_send";

interface Transaction {
  transactionId: string;
  sourceEventIds: string[];
  state: TransactionState;
  route: string;
  capabilities: Capability[];
  sender: { channel: string; address: string };
  input: { subject?: string; text: string; urls: string[] };
  memoryScope: { kind: "project" | "channel" | "user" | "global"; id: string };
  mamaMemoryIds: string[];
  obsidianNoteIds: string[];
}

interface WorkerTask {
  taskId: string;
  transactionId: string;
  stepId: string;
  objective: string;
  scopedContext: Array<{
    memoryId?: string;
    noteId?: string;
    title?: string;
    excerpt: string;
    sourceUri?: string;
    contentHash: string;
  }>;
  allowedCapabilities: Capability[];
  outputSchema: "research_result.v1" | "capture_result.v1";
  lease: { owner: string; token: string; expiresAt: string };
}

interface WorkerResult {
  schema: string;
  summary: string;
  findings: Array<{ statement: string; sourceUris: string[] }>;
  openQuestions: string[];
  contentHash: string;
  proposedMarkdown?: string;
  proposedTitle?: string;
}

interface MamaRuntime {
  intake: {
    claim(eventId: string, idempotencyKey: string): Promise<Transaction>;
  };
  transactions: {
    transition(tx: Transaction, next: TransactionState, reason: string): Promise<void>;
    appendEvent(tx: Transaction, event: Record<string, unknown>): Promise<void>;
    checkpoint(tx: Transaction): Promise<void>;
  };
  policy: {
    classify(tx: Transaction): Promise<{ route: string; capabilities: Capability[]; reviewRequired: boolean }>;
    validateWorkerResult(tx: Transaction, task: WorkerTask, result: WorkerResult): Promise<void>;
    can(tx: Transaction, capability: Capability): boolean;
  };
  memory: {
    recall(input: { query: string; scope: Transaction["memoryScope"]; limit: number }): Promise<WorkerTask["scopedContext"]>;
    save(input: { tx: Transaction; result: WorkerResult }): Promise<{ memoryIds: string[] }>;
  };
  obsidian: {
    upsertProjection(input: {
      tx: Transaction;
      title: string;
      markdown: string;
      contentHash: string;
    }): Promise<{ noteIds: string[] }>;
  };
  leases: {
    acquire(tx: Transaction, stepId: string, ttlSeconds: number): Promise<WorkerTask["lease"]>;
    release(lease: WorkerTask["lease"]): Promise<void>;
  };
  delivery: {
    queue(input: {
      tx: Transaction;
      subject: string;
      body: string;
      idempotencyKey: string;
    }): Promise<void>;
  };
}

interface NanobotAdapter {
  execute(task: WorkerTask): Promise<WorkerResult>;
}

export async function runMamaaTransaction(
  runtime: MamaRuntime,
  nanobot: NanobotAdapter,
  tx: Transaction,
): Promise<void> {
  let lease: WorkerTask["lease"] | undefined;

  try {
    await runtime.transactions.transition(tx, "sanitized", "mama_intake_validated");
    const classification = await runtime.policy.classify(tx);
    tx.route = classification.route;
    tx.capabilities = classification.capabilities;

    if (classification.reviewRequired) {
      await runtime.transactions.transition(tx, "needs_review", "classification_requires_review");
      await runtime.transactions.checkpoint(tx);
      return;
    }

    await runtime.transactions.transition(tx, "classified", "route_selected");

    const context = await runtime.memory.recall({
      query: tx.input.subject || tx.input.text,
      scope: tx.memoryScope,
      limit: 8,
    });
    await runtime.transactions.transition(tx, "context_loaded", "mama_core_recall_complete");

    if (!runtime.policy.can(tx, "worker_execute")) {
      throw new Error("WORKER_CAPABILITY_NOT_GRANTED");
    }

    await runtime.transactions.transition(tx, "planned", "mama_route_compiled");
    lease = await runtime.leases.acquire(tx, "nanobot_worker", 300);
    await runtime.transactions.transition(tx, "executing", "nanobot_lease_acquired");

    const task: WorkerTask = {
      taskId: `task_${crypto.randomUUID()}`,
      transactionId: tx.transactionId,
      stepId: "nanobot_worker",
      objective: tx.input.text,
      scopedContext: context,
      allowedCapabilities: tx.capabilities.filter((cap) =>
        ["memory_read", "public_url_fetch", "worker_execute"].includes(cap),
      ),
      outputSchema: tx.route === "capture_only" ? "capture_result.v1" : "research_result.v1",
      lease,
    };

    const result = await nanobot.execute(task);
    await runtime.transactions.transition(tx, "validating", "nanobot_result_received");
    await runtime.policy.validateWorkerResult(tx, task, result);

    // MAMA, not nanobot, commits operational memory.
    await runtime.transactions.transition(tx, "persisting", "worker_result_validated");
    if (runtime.policy.can(tx, "memory_write_local")) {
      const saved = await runtime.memory.save({ tx, result });
      tx.mamaMemoryIds.push(...saved.memoryIds);
    }

    // Obsidian is a controlled durable projection. It is never a direct worker write.
    if (runtime.policy.can(tx, "memory_write_obsidian") && result.proposedMarkdown) {
      const projected = await runtime.obsidian.upsertProjection({
        tx,
        title: result.proposedTitle || "Untitled transaction result",
        markdown: result.proposedMarkdown,
        contentHash: result.contentHash,
      });
      tx.obsidianNoteIds.push(...projected.noteIds);
    }

    await runtime.transactions.checkpoint(tx);
    await runtime.transactions.transition(tx, "responding", "memory_and_projection_committed");
    await runtime.delivery.queue({
      tx,
      subject: `Completed: ${tx.input.subject || "transaction"}`,
      body: result.summary,
      idempotencyKey: `response:${tx.transactionId}:v1`,
    });
    await runtime.transactions.transition(tx, "completed", "response_queued");
    await runtime.transactions.checkpoint(tx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await runtime.transactions.appendEvent(tx, {
      type: "transaction_failure",
      state: tx.state,
      error: message,
      retryable: isRetryable(message),
    });
    await runtime.transactions.transition(
      tx,
      isRetryable(message) ? "failed" : "needs_review",
      isRetryable(message) ? "retryable_failure" : "non_retryable_or_ambiguous_effect",
    );
    await runtime.transactions.checkpoint(tx);
    throw error;
  } finally {
    if (lease) await runtime.leases.release(lease);
  }
}

function isRetryable(message: string): boolean {
  return [
    "MCP_UNAVAILABLE",
    "MAMA_CORE_UNAVAILABLE",
    "WORKER_TIMEOUT",
    "DELIVERY_PROVIDER_TIMEOUT",
    "TEMPORARY_CONNECTOR_FAILURE",
  ].some((code) => message.includes(code));
}

/*
 * Nanobot-side adapter contract:
 *
 * 1. Accept exactly one WorkerTask.
 * 2. Use only task.scopedContext and explicitly granted capabilities.
 * 3. Never call MAMA memory.save, Obsidian writes, or external delivery.
 * 4. Return WorkerResult with a deterministic contentHash.
 * 5. Treat lease expiry or cancellation as a hard stop.
 */
