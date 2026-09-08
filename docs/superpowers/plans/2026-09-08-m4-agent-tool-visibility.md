# M4.3.2 Agent Tool Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Extend `plugin.verify` so one exact disposable DSH boot can prove requested Agent-scoped Tool capability visibility, while preserving Host Service visibility, exact artifact/target/lifecycle binding, and the existing verification reducer/status vocabulary.

**Architecture:** Keep one Protocol request, one verification worker, one boot process, and one canonical `visibility` stage. `agent-tool` assertions create one verifier-owned Agent in the generated boot probe, read `ctx.tools.schemas(handle.agent)` once for the assertion batch, and await exact handle disposal before emitting a V2 visibility PASS/FAIL marker. Frontends only project the canonical Protocol vocabulary.

**Tech Stack:** TypeScript 6, Node 22/24/26, Vitest, JSON Schema/Ajv, DSH/Cordis runtime, GitHub Actions, registry `@deepseek-ai/dsh@0.1.2-rc.1` acceptance.

**Spec:** `docs/superpowers/specs/2026-09-08-m4-agent-tool-visibility-design.md`

## Global Constraints

- Preserve `dsh-target-v2`, `dsh-profile-lifecycle-v1`, `dsh-contract-index-v1`, and `dsh-plugin-artifact-v1` semantics.
- Do not touch frozen H1 assets, R2-dev ranker behavior, or H2 readiness.
- Keep `executionPolicy: 'safe'`; this remains configuration isolation, not a malicious-code sandbox.
- No second verifier, no caller-Agent reuse, no Client/page visibility, no Tool execution.
- At most one Toolchain-owned Agent per verification boot, regardless of Agent Tool assertion count.
- Host Service-only requests must create zero Agents.
- Agent handle disposal must settle before visibility PASS/FAIL is emitted.
- Preserve the existing `visibility` check and `VERIFY_VISIBILITY_FAILED`; add no VerificationReport status.
- Every production behavior change follows a focused RED → GREEN test.
- Final merge requires fresh all-green CI on the exact final HEAD, including the real DSH public path.

---

### Task 1: Freeze the Protocol and parser vocabulary

**Files:**
- Modify: `spec/schemas/v1/toolchain-protocol.schema.json`
- Modify: `src/protocol/generated.ts` via canonical generator output
- Modify: `src/protocol/request-validation.ts`
- Modify/Test: `tests/protocol/plugin-verify-visibility.spec.ts`

**RED**

Add tests that require:

- `{kind:'agent-tool', name:'candidate_tool'}` to validate and round-trip;
- mixed `host-service` + `agent-tool` assertions to preserve both kinds;
- same name in different kinds to be accepted;
- duplicate same-kind identity to be rejected;
- unknown `kind:'tool'` to remain rejected;
- existing empty/name-length/32-item bounds to remain closed.

Run the branch CI and confirm failure is isolated to the new Protocol expectations before modifying production schema/parser.

**GREEN**

Change `pluginVisibilityAssertion.kind` from `const:'host-service'` to closed enum `['host-service','agent-tool']`; regenerate the Protocol type; update the parser to accept and preserve either kind and dedupe by `(kind,name)`.

Verify `check:generated`, Protocol conformance, typecheck, and the focused visibility tests.

### Task 2: Make the boot probe own an Agent epoch

**Files:**
- Modify: `src/verification/boot-probe.ts`
- Modify/Test: `tests/verification/boot-probe.spec.ts`

**RED**

Require generated source for an `agent-tool` assertion to:

- export an injection requirement for `agents` and `tools` only when Agent Tool assertions exist;
- use an async `apply` path;
- create exactly one Agent with a verifier-owned UUID-derived session id;
- call the Tool capability catalog with the exact returned Agent;
- dispose the exact handle in `finally`;
- emit visibility outcome only after disposal;
- never create an Agent for Host Service-only assertions;
- use `DSH_TOOLCHAIN_VERIFY_VISIBILITY_PROBE_V2` markers while leaving the boot marker V1.

Also test a mixed assertion batch generates only one Agent creation path.

**GREEN**

Split the generated visibility logic by kind. Preserve existing Host Service lookup. For Agent Tool assertions, obtain `agents`/`tools`, create one owned Agent, materialize `tools.schemas(handle.agent)` once, evaluate every requested name, and await `handle.dispose()` before marker emission. Treat create/catalog/dispose failure as visibility failure.

Do not execute any Tool body.

### Task 3: Preserve worker/reducer semantics while making diagnostics kind-neutral

**Files:**
- Modify: `src/verification/packed-worker.ts`
- Test: `tests/verification/packed-worker.spec.ts`
- Test: `tests/model/plugin-verify.spec.ts` only if reducer behavior needs an explicit regression assertion

**RED**

Add a focused test proving an `agent-tool` assertion is forwarded to the boot probe and a FAIL marker still yields:

- `boot = passed`;
- `visibility = failed`;
- diagnostic `VERIFY_VISIBILITY_FAILED`;
- worker terminal `completed`;
- shared reducer report `failed` rather than transport failure.

**GREEN**

Keep marker interpretation and stage reduction unchanged. Generalize the Host-Service-specific diagnostic summary to all requested runtime visibility assertions. No new diagnostic code or report field.

### Task 4: Project frontend parity

**Files:**
- Modify: `src/frontends/cli/index.ts`
- Modify: `src/integrations/dsh/plugin-verify-tool.ts`
- Test: `tests/cli/plugin-verify.spec.ts`
- Test: `tests/dsh/plugin-verify-tool.spec.ts`
- Test: `tests/mcp/plugin-verify.spec.ts`
- Test: frontend parity tests if they encode the exact request vocabulary

**RED**

Add tests requiring:

- CLI repeatable `--visibility-tool <name>` maps to `kind:'agent-tool'`;
- existing `--visibility-service` remains unchanged;
- mixed CLI options produce both assertion kinds deterministically;
- native DSH Tool parameter schema accepts only `host-service|agent-tool`;
- MCP canonical input schema accepts the new kind and remains executing/non-idempotent.

**GREEN**

Add `--visibility-tool` to CLI help/options/request construction and plugin-option conflict checks. Expand the native DSH Tool schema/description. MCP should require no hand-written schema change beyond canonical Protocol projection.

### Task 5: Add real DSH public-path Agent Tool acceptance

**Files:**
- Modify or add: `scripts/smoke-plugin-verify*.mjs`
- Modify: `.github/workflows/ci.yml` only if a new invocation is necessary
- Test: policy smoke tests guarding invocation count/location

**RED**

Add policy/acceptance expectations before production smoke support. Avoid multiplying registry installs across Node compatibility lanes.

The real fixture candidate must register a minimal valid Tool through current DSH ToolRuntime. Use the documented Tool registration surface and a Tool definition with valid parameters/output contract; the Tool body is never invoked.

Acceptance cases against `@deepseek-ai/dsh@0.1.2-rc.1`, profile `headless`:

1. present Agent Tool → public CLI returns semantic `verified`, `boot=passed`, `visibility=passed`;
2. intentionally missing Agent Tool → public CLI returns semantic `failed`, `boot=passed`, `visibility=failed`, `VERIFY_VISIBILITY_FAILED`.

Both must assert exact artifact/target/lifecycle binding, cleanup success, and active-profile immutability.

**GREEN**

Implement the minimum smoke integration, preferably reusing an existing primary-only DSH installation path rather than adding a second redundant registry-heavy job.

### Task 6: Synchronize normative documentation and close governance

**Files:**
- Modify: `spec/verification.md`
- Modify: `docs/architecture.md`
- Modify: `docs/roadmap.md`
- Update: Issue #201 and PR description

After production behavior and real acceptance are green:

- document `agent-tool` as capability visibility, explicitly distinct from model presentation and Tool execution;
- document one owned Agent epoch and exact handle disposal;
- keep Client/page and behavior assertions deferred;
- record upstream authority commit and final CI evidence;
- mark issue acceptance complete only on final exact-head all-green CI.

### Task 7: Final verification and integration

1. Inspect the complete PR diff for scope creep, generated drift, and accidental H1/R2 changes.
2. Confirm no unresolved review threads/comments.
3. Confirm final HEAD CI has `success` for Node 22/24/26, Windows/macOS boundary and primary real-DSH artifact truth.
4. Mark PR ready only after that exact final HEAD is green.
5. Squash-merge with `expected_head_sha`.
6. Verify `main` points at the merge commit and Issue #201 is closed completed with immutable evidence links/run ids.