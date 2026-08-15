# BUILDLOG

Source of truth for what exists in this fork (`albatrossflyon-coder/nanobot`, tracking upstream `HKUDS/nanobot`) beyond upstream's own docs.

## Tech Stack

- **Languages:** Python, TypeScript
- **Frameworks/Libraries:** FastAPI-style channel manager, React (webui), LangGraph-adjacent agent loop
- **Dev Tools:** pytest, ruff, basedpyright

---

## 2026-08-15 12:35 AM CDT — Added idempotence test for the Mistral extra_content strip

**Status: added, passing, pushed.** One good idea salvaged from an external AI's proposed test script (which otherwise tested a nonexistent function/module and a message shape that doesn't match the real bug — hallucinated, not grounded in this codebase). `test_strict_schema_strip_is_idempotent` in `tests/agent/test_gemini_thought_signature.py` confirms `_sanitize_messages` is a no-op when run twice on its own output — real regression protection the earlier fix didn't explicitly cover. 19/19 tests pass.

## 2026-08-15 12:20 AM CDT — Obsidian World integration planning docs added (research, no code)

**Status: documentation only, not built — planning reference for the nanobot + Obsidian World integration.**

Chris ran a multi-AI brainstorm (ChatGPT, Manus) on the "Obsidian World" architecture (see the shared vault's Obsidian World roadmap artifact and CC memory `2026-08-15-session-tic1.md`). Manus produced a detailed, evidence-based architecture comparison using a real "repository-architecture-comparison" methodology (lifecycle-stage mapping, seam classification: use-directly/wrap/replace/defer, Observed/Inferred/Recommended/Unknown evidence tiers). Saved 5 real output docs to `docs/obsidian-world-planning/`:

- `HKUDS_nanobot vs. Obsidian World.md` — full transaction-lifecycle mapping (received→sanitized→classified→...→completed/failed) showing exactly which nanobot seams to use directly vs. wrap vs. replace.
- `Nanobot Transaction Specification.md` — JSON-schema-level contract: inbound envelope, classification result, Obsidian note front matter, OB1 session state, event records, idempotency/retry rules.
- `Nanobot ↔ Obsidian World API Bridge Specification.md` — full REST/MCP API contract (786 lines): intake, transaction control, OB1 sessions, obsidian-mind MCP gateway, worker API, delivery, health/observability, auth model, minimal first-slice endpoint set, worked end-to-end call sequence.
- `Nanobot + obsidian-mind Implementation Roadmap.md` — 8 phases with exit criteria, a first-6-tickets table, and an explicit defer list (Octop, NotebookLM, understand-anything, more agents, redesigned dashboard).
- `Repository comparison findings.md` — surfaced a new candidate repo, `breferrari/obsidian-mind` (Obsidian vault template giving Claude Code/Codex/Gemini CLI persistent memory via git-tracked notes + session-lifecycle hooks + MCP server) — not yet read/scanned per the standing security rule.
- `repository-architecture-comparison-SKILL.md` — the actual skill definition behind this analysis (Chris pasted it directly after a mismatched/misnamed `.skill` file turned out to be unrelated Manus-internal noise). Genuinely well-designed, candidate for porting into Claude Code's own skill library for future "is there a repo like X" research — not yet ported.

**Core architectural warning this analysis independently confirms** (matches ChatGPT's and Manus's earlier chat-based recommendations): nanobot's own internal memory/session history must never become a second source of truth alongside Obsidian. Every integration point in the API spec treats Obsidian as canonical and nanobot/OB1 as session-scoped.

**Not started:** none of Phase 0 onward has been built. This is planning reference only.
## 2026-08-11 — Tool-call-markup-leak fix: 4 original gaps closed, 3 new gaps found by code-review

**Context:** A model finalizing with no tools offered could still emit literal `<tool_call><function=...>` text instead of a real answer, and that raw markup could reach a real user-facing channel. Confirmed live twice today via real email to Chris (`~/.nanobot/logs/gateway.log`, 14:02 and 14:27 CDT — `Response to email:...: <tool_call>` at INFO level, meaning it was never blocked; the filter that should have caught it was built but never actually committed/active in the running gateway).

**4 gaps from the prior session's `/code-review` pass — all fixed and tested this session:**
1. Dominant per-turn finalize path (`runner.py` `_run_core`, where most turns actually end) had no leak guard — only the max-iterations retry path did. Fixed: added `contains_leaked_tool_call_markup(clean)` check alongside the existing blank-content check, same pattern (fallback message, `stop_reason="leaked_tool_call_markup"`, drain injections, break).
2. Only the email channel had the egress filter; 15 other channels didn't. Fixed by centralizing instead of propagating: `ChannelManager._send_once` (the single funnel all non-streaming channel sends pass through, confirmed via `find_references`/`search_text`) now runs the check once for all 17 channels. Removed the now-redundant duplicate check from `EmailChannel.send()`.
3. Regex `<tool_call\b` missed the plural `<tool_calls>` wrapper tag. Verified live that **both** `<tool_calls>` and `</tool_calls>` failed to match (the prior session only caught the opening-tag case) — fixed to `<tool_calls?\b` / `</tool_calls?>`.
4. The blocked-leak warning log wrote the raw leaked content (potentially shell commands/session IDs) unredacted. Fixed at the source: the new centralized check in `_send_once` never logs the raw content at all (length only).

**Verification:** Full test suite 5914 passed / 44 skipped / 0 failed. `vuln-hunter scan_diff` clean except one unrelated pre-existing item (see below). New/moved tests: `tests/agent/test_runner_safety.py` (2 new — dominant-path leak rejection + clean-response negative case), `tests/channels/test_channel_manager_leak_filter.py` (3 new — centralized filter, plural-tag regression, normal-content passthrough), `nanobot/channels/email/tests/test_email_channel.py` (obsolete email-specific leak test removed, now covered at the manager level instead).

**3 new findings from a fresh `/code-review high` pass after the fix — triaged with Chris, not silently shipped-and-disclosed:**

1. **Streaming bypass (pre-existing, NOT introduced tonight, NOT fixed tonight).** The filter only runs in `_send_once`'s non-streaming branch. A leaked `<tool_call>` in a streaming response (webui/websocket) would already display live, token-by-token, before any finalize-time check runs — this gap existed before tonight's fix too (streaming had zero leak protection either way) and closing it properly needs mid-stream detection or buffering, a real design change, not a quick patch. **Status: open, tracked as a follow-up, not fixed.**
2. **MessageTool-suppression behavior for the new `leaked_tool_call_markup` stop_reason was a genuine design question, not a clear bug** (`loop.py` `_assemble_outbound`, line ~1594). `empty_final_response` always suppresses the fallback notice when `MessageTool` already sent real content this turn. `leaked_tool_call_markup` was following the general rule instead (suppress only if no new injections occurred) — a code-review report initially described this backwards (claimed the leak notice gets silently dropped when the empty one doesn't; direct code tracing showed the opposite: in the `had_injections=True` case, the leak notice was the one that got delivered, `empty_final_response` was the one still suppressed). Chris's call: always suppress, matching `empty_final_response` — real content already went out via MessageTool, so a leak on the wrap-up has nothing useful to add. **Status: fixed 2026-08-11** — `stop_reason in ("empty_final_response", "leaked_tool_call_markup")` now both suppress unconditionally. New test: `tests/tools/test_message_tool_suppress.py::test_injected_followup_with_message_tool_suppresses_leaked_markup_notice`.
3. **Regex `<function\s*=` / `TOOL_CALL:` can false-positive on legitimate prose** (e.g. an answer that explains or demonstrates the agent's own tool-call syntax). **Pre-existing** — both patterns were in `_LEAKED_TOOL_CALL_RE` before tonight; this session only touched the `<tool_call>`/`<tool_calls>` singular/plural portion. Checked `~/.nanobot/logs/gateway.log` for evidence this ever fired as a false positive in production — found none; the filter was never actually active before tonight (see Context above), so this risk hasn't manifested yet, but is real now that the filter is about to go live for real. **Status: open, not fixed tonight, worth a follow-up if it's ever observed firing on legitimate content.**

**Also caught tonight:** checked GitHub notifications before pushing and found CI already failing on this same branch from an earlier commit (`6e8e2755`) — a `basedpyright --strict` error in `runner.py` (`append`/`sorted` on a partially-unknown type). A follow-up commit (`7cd2b29f`) already fixed that one but was stuck on GitHub's `action_required` approval gate, unverified. Ran `basedpyright` locally against all files touched tonight and found a **new** instance of the same error class in my own new code (`runner.py:817`, `len(clean)` where `clean: str | None` — the `is_blank_text` guard proves it's non-empty at runtime but basedpyright doesn't narrow through that call). Fixed (`len(clean or "")`). Re-ran clean: 0 errors across all 9 touched files.

**Branch:** `fix/tool-call-loop-detection` in `C:\Repos\nanobot`. Committed (`0ac578b4`) and pushed to `fork` (`albatrossflyon-coder/nanobot`) — remote SHA independently verified via `gh api` to match local HEAD exactly. Not yet merged into `HKUDS/nanobot#5344` upstream; watch that PR for maintainer review.

## 2026-08-12 03:20 CDT — PR #5344 extended: same-turn batched duplicate detection

**Status: pushed to `fork/fix/tool-call-loop-detection` (`9e21f86c`), remote SHA verified, PR comment posted. Still awaiting maintainer review.**

Closed the one gap the PR's own description disclosed as out-of-scope: `_detect_tool_call_loop` tracks one signature per whole round, so it only catches a loop repeating identically *across* separate rounds — it can't see N identical calls batched *into* a single round (e.g. three parallel `read_file` calls with the same path), since that round produces its own distinct joined signature exactly once. Added `_detect_intra_round_duplicate_calls()` in `runner.py`, checked alongside the existing cross-round guard, firing the first time a round contains 3+ identical calls rather than requiring the round to repeat. Two new tests mirroring the existing loop-guard tests' conventions.

**Verified:** `tests/agent/test_runner_safety.py` 13/13 passed, `ruff check` clean, `basedpyright --strict` clean, `vuln-hunter scan_diff` clean. Full suite: 5915 passed, 2 pre-existing failures unrelated (see next entry), 44 skipped.

## 2026-08-15 12:07 AM CDT — Fixed the Gemini→devstral 422 thought_signature bug

**Status: fixed, unit-tested, full suite clean (no new failures) — committed and pushed to `fork`.**

**Context:** after the 2026-08-13 Gemini→devstral-2512 primary-model swap, the `email:albatrossflyon1@gmail.com` session's stored history carried Gemini's `extra_content`/`google.thought_signature` field on old tool_calls. Every replay attempt against devstral 422'd (`extra_forbidden: Extra inputs are not permitted`), confirmed live in `gateway.log` at 2026-08-14 12:08:49. This meant nanobot could not process any request in that session at all — every turn errored out.

**Root cause:** `devstral` is a keyword on the `mistral` `ProviderSpec` (`nanobot/providers/registry.py`), and Mistral validates its request schema strictly, rejecting unrecognized fields on tool_calls (the same reason `strip_history_reasoning_content` already exists for `reasoning_content`). Gemini's `extra_content` is only meaningful to Gemini's own endpoint — replaying it verbatim to Mistral is what triggered the 422.

**Fix:** added a new `strip_foreign_tool_call_extra_content: bool = False` field to `ProviderSpec` (same declarative pattern as `strip_history_reasoning_content`), set `True` on the Mistral spec entry, and gated a strip of `extra_content` from tool_calls in `OpenAICompatProvider._sanitize_messages` behind that flag. Scoped specifically to Mistral, not "any non-Gemini provider" — persisted session history is untouched either way (`_sanitize_messages` only shapes the outbound wire payload), so a future switch back to Gemini still has the signature available.

**Real gotcha caught mid-fix:** the first version of this fix stripped `extra_content` for *any* non-Gemini spec, which broke an existing test (`test_openai_compat_preserves_message_level_reasoning_fields` in `tests/providers/test_litellm_kwargs.py`) that deliberately asserts a generic/unknown provider *preserves* `extra_content` verbatim — that test passed on the clean baseline, confirming the blanket rule was wrong, not the test. Found `devstral` explicitly listed as a `mistral` keyword and rescoped the fix to that spec specifically instead.

**Verification:** `tests/agent/test_gemini_thought_signature.py` (18/18, including a corrected test that now targets a Mistral-spec provider instead of a no-spec one) and `tests/providers/test_litellm_kwargs.py` all green. Full suite (`uv run pytest tests/`) run twice: first pass (broad fix) — 9 failed/4988 passed, 1 of those caused by the bug in my own first-draft fix. Second pass (corrected, Mistral-scoped fix) — 7 failed/4990 passed/44 skipped, all 7 pre-existing and unrelated (`test_session_location` x1, `test_exec_session_tools` x4 — timing-sensitive, `test_settings_api` x2 — the known timezone flake already tracked upstream, awaiting review on PR #5349). Zero new failures from this change. `vuln-hunter scan_diff`: 1 finding, a pre-existing SHA1 usage in `_normalize_tool_call_id` unrelated to this diff (already a known, accepted, non-blocking finding).

**Files changed:** `nanobot/providers/registry.py`, `nanobot/providers/openai_compat_provider.py`, `tests/agent/test_gemini_thought_signature.py`.

**Not yet done:** the live gateway process needs a restart to pick up this code change (a running Python process doesn't hot-reload); Render deployment prep for making the email channel always-on independent of the local machine (`render.yaml` currently only wires `ANTHROPIC_API_KEY` — the actual live setup needs `NANOBOT_GMAIL_APP_PASSWORD`, the devstral/Mistral key, `GEMINI_API_KEY`, `SCAN_API_KEY` too).

## 2026-08-12 03:35 CDT — Found and fixed a real test bug: token-usage timezone mismatch

**Status: filed as [HKUDS/nanobot#5348](https://github.com/HKUDS/nanobot/issues/5348), fixed and opened as [HKUDS/nanobot#5349](https://github.com/HKUDS/nanobot/pull/5349), pushed to `fork/fix/token-usage-timezone-test-mismatch` (`ef60cb57`), remote SHA verified.**

While running the full suite to verify the loop-guard extension above, found `test_settings_payload_includes_token_usage_summary` and `test_settings_usage_payload_returns_lightweight_token_usage` failing. Confirmed pre-existing (fails identically on a clean `git stash`d checkout) and unrelated to the loop-guard work before investigating further.

**Root cause:** both tests call `record_token_usage()` with no `timezone_name`, defaulting to UTC, while the read-back path (`settings_payload()`/`settings_usage_payload()`) always reads with `config.agents.defaults.timezone` (`America/Chicago` by default). Reproduced live with a standalone debug script dumping state at each stage: whenever UTC has already rolled to the next calendar day but Chicago hasn't (roughly a 5-hour daily window — reproduced at ~22:00-03:00 CDT), the row written under the UTC date falls outside every windowed field's `today` cutoff (`requests_30d`, `active_days_30d`, `total_tokens_30d`, `current_streak_days` all zero out; `total_tokens`/`peak_day_tokens` still look right only because those two specific fields are unwindowed sums over all stored days).

Checked all three real production call sites before concluding this was test-only: `gateway_runtime.py` (x2) and `command/builtin.py` all correctly thread `config.agents.defaults.timezone` through already. `tests/webui/test_token_usage.py` avoids the bug entirely by always pinning both `timezone_name` and an explicit `now=` — these two tests were the only ones missing `timezone_name` on the write side.

**Fix:** pass `timezone_name=config.agents.defaults.timezone` to both `record_token_usage()` calls, matching the established convention. Verified: both tests pass, full `test_settings_api.py` file 85/85 passed.
