---
name: repository-architecture-comparison
description: Compare public repositories against a proposed software architecture, identify the closest implementation patterns and gaps, map one repository to a transaction lifecycle, and produce an integration roadmap and presentation-ready findings. Use for repository research, architecture benchmarking, GitHub project comparison, or deciding whether to fork, compose, or build.
---

# Repository Architecture Comparison

Use this skill to turn a broad "is there a repo like this?" question into an evidence-based architecture comparison rather than a list of links.

## Core workflow

1. **Define the target architecture.** Extract components, boundaries, lifecycle, sources of truth, runtime constraints, integrations, and non-goals. Write the target as a short component table before searching.
2. **Search broadly, then refine.** Search for repositories matching the whole system and repositories matching each major layer separately. Prefer canonical GitHub URLs and inspect repository-owned documentation.
3. **Select complementary candidates.** Choose repositories representing coordinator/runtime, durable memory, intake/triage, retrieval/indexing, agent workers, or UI/control plane. Do not force one project to match every layer.
4. **Verify each candidate.** Record its URL, stated purpose, architecture, inputs, outputs, persistence, deployment model, integrations, license if relevant, activity signal, and explicit limitations. Separate observed facts from interpretation.
5. **Compare directly to the target lifecycle.** Map stages such as received → normalized → classified → context_loaded → planned → executing → persisting → responding → terminal. Mark native support, adaptable support, missing support, and the proposed integration boundary.
6. **Choose composition versus forking.** Fork only when the candidate owns the right abstraction and its data model can remain compatible. Compose when candidates solve adjacent layers or when forking would damage source-of-truth boundaries.
7. **Write a phased roadmap.** Start with the smallest end-to-end vertical slice. Include contracts, adapters, state transitions, idempotency, retries, observability, tests, migration strategy, and explicit non-goals.
8. **Prepare deliverables.** Produce a comparison report, lifecycle matrix, roadmap, and — when requested — presentation content with references and a clear recommendation.

## Evidence rules

Use direct repository pages or repository-owned documentation for claims about functionality. Treat search snippets as discovery aids only. Cite public sources with Markdown reference links. Distinguish Observed, Inferred, Recommended, and Unknown. Do not claim support for a feature merely because topic tags suggest it.

## Comparison matrices

Use this minimum structure:

| Candidate | Primary role | Native overlap | Adaptable overlap | Important gaps | Recommended use |
|---|---|---|---|---|---|

For a transaction or event workflow, add:

| Target stage | Candidate capability | Boundary or adapter | State/data contract | Test required | Integration-point method |
|---|---|---|---|---|---|

Identify the candidate's actual seams: channel adapter, message envelope, agent loop, tool registry, memory provider, MCP server, checkpoint store, scheduler, event log, outbound response adapter, and deployment entry point. Map each seam to exactly one target responsibility.

Classify each seam as:
- **Use directly:** semantics already match.
- **Wrap:** preserve the candidate behind a target-owned adapter and schema.
- **Replace:** behavior conflicts with the target's source-of-truth or reliability contract.
- **Defer:** useful later, but not required for the first complete transaction.

Do not allow a runtime's internal memory to become the target's canonical knowledge store unless the user explicitly chooses that change.

## Roadmap quality gates

Every roadmap must specify the first vertical slice, acceptance criteria, state and idempotency model, failure/retry policy, and the point at which additional subsystems may be introduced. Include at least one lighter-weight alternative when deployment or hosting choices are discussed. Do not recommend adding another agent, database, graph, or dashboard merely because it is available.

## Presentation guidance

For a deck, use no more than 10-12 slides. A reliable sequence is: decision summary; target architecture; candidate landscape; closest coordinator; closest memory model; email/transaction reference; direct lifecycle mapping; proposed integration architecture; phased roadmap; risks and acceptance criteria; final recommendation; references. Keep citations on relevant slides and include a final references slide.

## Reusable output structure

1. Executive conclusion.
2. Target architecture and evaluation criteria.
3. Candidate comparison table.
4. Direct lifecycle mapping.
5. Exact integration points.
6. Implementation roadmap.
7. Risks, non-goals, and acceptance tests.
8. References.

Keep results grounded in inspected repository content. Never imply that a repository is production-ready, actively maintained, secure, or license-compatible without evidence.
