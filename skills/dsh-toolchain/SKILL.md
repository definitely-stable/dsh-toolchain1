---
name: dsh-toolchain
description: Develop, fix, review, or migrate DeepSeek Harness plugins against the exact installed DSH target. Use when work depends on DSH APIs, profiles, tools, services, events, plugin compatibility, or when an API may differ from model memory. Resolve the target first, search exact contracts, inspect evidence-backed matches, and never guess unsupported DSH behavior.
---

# DSH Toolchain

Use DSH Toolchain as the source of truth for the installed Harness target. Model memory and examples from another DSH train are hints only.

## Core workflow

1. Establish the exact target before making DSH-specific implementation decisions.
   - Native DSH: use `toolchain_target_resolve`.
   - MCP: use `target.resolve`.
   - CLI: use `dsh-toolchain target resolve`.
   - Keep the returned target fingerprint attached to the work. Do not silently switch profile, DSH home, package root, or invocation overlays later.

2. Before using or changing an uncertain DSH API, search the exact target.
   - Native DSH: `toolchain_contract_search`.
   - MCP: `contract.search`.
   - CLI: `dsh-toolchain contract search`.
   - Search by the user's intent or the suspected symbol. Prefer a small result limit first; broaden only when necessary.

3. Inspect the relevant search match before relying on it.
   - Native DSH: `toolchain_contract_inspect`.
   - MCP: `contract.inspect`.
   - CLI: `dsh-toolchain contract inspect`.
   - `contractId` MUST come from `contract.search` `data.matches[].id`.
   - `matches[].evidenceIds` and `data.evidence[].id` are provenance identifiers, not inspectable contract IDs.
   - Carry the exact `contractIndexFingerprint` returned by the search into inspect.

4. Implement from inspected evidence, not from an API name alone.
   - Treat declaration/package evidence as proof that a capability is declared, not proof that it is currently mounted or available.
   - Positive Agent-scoped Host Tool observation may establish `availability = available`.
   - `availability = unknown` means unknown; do not rewrite it as unavailable.
   - Preserve relevant provenance in the implementation/review summary when it explains a compatibility decision.

5. Fail closed on stale or mismatched evidence.
   - `CONTRACT_INDEX_STALE` means reacquire/search again against the current exact target; do not reuse the old inspect result.
   - A target fingerprint change means the compatibility question changed. Resolve and reason from the new target instead of merging evidence from both targets.
   - If Toolchain cannot prove an API or runtime property, state that it is unproven and use ordinary exact-target evidence only when available. Do not fill the gap from memory.

6. After editing a plugin, use the strongest Toolchain product surface that actually exists in the installed version.
   - Today, target resolution and contract search/inspect are the canonical implemented surfaces.
   - When a documented Exact Target Plugin Check or isolated verification surface is present in a later Toolchain version, prefer it over recreating validation or verification manually.
   - Never invent a Toolchain command/tool that the resolved installed version does not expose.

## When Toolchain lookup is mandatory

Use exact-target lookup before finalizing when any of these are true:

- the task names a DSH/Cordis service, event, tool, profile field, manifest field, plugin API, or package API;
- code is being migrated between DSH versions or profiles;
- an API is remembered but not already proven by the current repository/target;
- a compile/runtime failure could be caused by DSH version drift;
- the answer claims an API is absent, renamed, available, or unavailable;
- a plugin compatibility conclusion depends on the installed target.

Do not spend Toolchain calls on ordinary language/library facts unrelated to DSH.

## Search discipline

- Start with the narrowest meaningful intent/symbol query.
- Inspect a plausible match instead of repeatedly searching synonyms without examining evidence.
- If several matches are plausible, inspect the smallest set needed to disambiguate them.
- Do not select a lower-ranked result only because it matches model memory better.
- Do not use an evidence path such as `types:...` as `contractId`.
- If search finds nothing, report the miss. Do not fabricate the missing API.

## Output discipline

For implementation/review work, keep the user-facing result concise but make these distinctions explicit when relevant:

- exact target/profile used;
- contract proven by Toolchain;
- declared capability versus observed runtime availability;
- stale/missing/unproven evidence;
- any remaining compatibility uncertainty.

The goal is not to mention Toolchain in every answer. The goal is to prevent DSH-specific code and compatibility claims from being based on guesses.