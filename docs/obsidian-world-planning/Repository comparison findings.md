# Repository comparison findings

## HKUDS/nanobot
URL: https://github.com/HKUDS/nanobot

The repository describes nanobot as an ultra-lightweight, self-hosted Python personal AI agent framework with a small agent loop, chat-app and email channels, tools, long-term memory, MCP integrations, model routing, multi-agent delegation, scheduled automation, and an OpenAI-compatible API. Its architecture centers incoming messages, LLM-selected tools, and memory/skills as contextual additions rather than a heavy orchestration layer. It supports deployment with persistent storage for sessions, memory, and WebUI history.

Relevance: closest match for the always-on coordinator and channel/tool layer. Gap: it is not the full proposed Obsidian World; the repository does not by itself establish Obsidian as the canonical durable knowledge store, OB1 as a separate session database, or the proposed Obsidian→RAG projection and dashboard boundaries.

## edonyzpc/personal-assistant
URL: https://github.com/edonyzpc/personal-assistant

This is an Obsidian plugin for automatically managing Obsidian with AI agents. Its README highlights a Pagelet review assistant, structured suggestions saved as review notes, and LLM chat with memory. The repository is an Obsidian-native automation and memory-management layer rather than an external always-on coordinator.

Relevance: useful for in-vault capture, review, note management, and agent-assisted Obsidian operations. Gap: it does not appear to be the phone/email intake hub or a cross-agent external coordinator.

## breferrari/obsidian-mind
URL: https://github.com/breferrari/obsidian-mind

This is a self-organizing Obsidian vault template giving Claude Code, Codex CLI, and Gemini CLI persistent memory. It keeps durable knowledge in git-tracked, Obsidian-browsable linked notes; uses hooks for session start, prompt classification, post-write validation, pre-compaction backup, and session-end checklists; and exposes the vault across repositories through an MCP server with search, graph expansion, scoped recall, remembering, work recording, and health checks.

Relevance: closest match for the proposed Obsidian canonical-memory layer, multi-agent worker interoperability, lifecycle hooks, scoped memory, provenance, and health surfaces. Gap: it is primarily a vault-plus-agent-hooks system, not an always-on email/event coordinator with the nanobot transaction lifecycle.

## langchain-ai/executive-ai-assistant
URL: https://github.com/langchain-ai/executive-ai-assistant

This repository implements an Executive AI Assistant using LangGraph. It monitors Gmail, supports email triage guidelines for ignore/notify/respond, ingests emails, and can run locally or on LangGraph Platform with scheduled ingestion. It includes an Agent Inbox interaction path and deployment instructions.

Relevance: closest match for email intake, triage, scheduled/event-like ingestion, graph-based orchestration, human interaction, and outbound assistant behavior. Gap: it is an email assistant rather than an Obsidian-first personal operating environment; the README does not establish the proposed durable vault, OB1 session boundary, or agent-agnostic worker layer.

## Preliminary conclusion

No single repository appears to implement the whole proposed system. The strongest architecture is compositional: use HKUDS/nanobot as the coordinator/channel baseline, obsidian-mind as the durable-memory and cross-agent vault pattern, and LangChain's executive-ai-assistant as a reference for email ingestion and triage. The Obsidian personal-assistant plugin is a useful optional reference for in-vault review and capture behavior.
