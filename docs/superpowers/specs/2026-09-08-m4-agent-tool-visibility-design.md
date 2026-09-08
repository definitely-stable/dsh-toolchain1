# M4.3.2 Agent Tool Visibility Design

Status: proposed implementation contract for issue #201.

## Goal

Extend the existing M4 runtime visibility assertion surface from Host Service presence to Agent-scoped Tool capability presence without broadening the verification claim into Tool execution, Client/page inspection, generic behavior assertions, or a new runtime verifier.

The operation must answer one narrow question against the same disposable exact DSH composition already used by `plugin.verify`:

> Is the named Tool present in the capability catalog of a real Toolchain-owned Agent after the candidate plugin has been installed, composed, and booted?

## Upstream authority

The design follows current DSH runtime semantics at upstream commit `c389f96bf3a9b6807cb71ed6bdad5849be0df6d8`.

The Host Cordis Inspect provider `Tool/listTools` describes itself as returning every Tool schema currently callable by the requesting Agent and implements that claim by delegating to:

```ts
ctx.tools.schemas(context.agent)
```

`ToolRuntime.schemas(scope)` is therefore the capability catalog for that exact scope. A root/global lookup is not equivalent evidence because scoped registrations, inherited restrictions, and scoped shadowing can produce different visible Tool sets for different Agents.

Programmatic Agent creation for the probe uses the synchronous `agentLoop.create(id)` seam, which returns a registered Agent on agent-capable compositions and is the same seam backing the M2.2 live DSH smoke. `ctx.agents.create(options)` is not used: current DSH trains register no agent factory in verification boots (`agents.create` fails with "no agent factory registered"), and the returned `AgentHandle.dispose` teardown has no counterpart on the `agentLoop` seam — the created Agent lives only in the disposable boot process, so worker process teardown owns Agent lifetime.

Agent services are unavailable in the probe root scope (`rootCtx.get('agentLoop')` is `undefined` there), so the generated probe declares `export const inject = ['tools', 'agentLoop']` and reads the services inside its synchronous `apply`. A bare `export const inject` naming unavailable services gates probe application, which fails closed through the missing-marker boot path.

## Request contract

Protocol v1 keeps the existing `visibilityAssertions` array and extends only its closed discriminator:

```ts
type PluginVisibilityAssertion =
  | { readonly kind: 'host-service'; readonly name: string }
  | { readonly kind: 'agent-tool'; readonly name: string }
```

The existing bounds remain:

- at least 1 assertion when the field is present;
- at most 32 assertions total across all kinds;
- `name` must contain a non-whitespace character;
- maximum name length 256;
- exact same `(kind, name)` may appear only once;
- the same `name` under different kinds is valid because the namespaces are semantically distinct.

No VerificationReport field or status vocabulary changes. Both assertion kinds are observations for the existing canonical `visibility` check.

## Runtime boundary

The existing execution path remains one worker and one boot epoch:

```text
exact packed artifact
        ↓
package/install/compose
        ↓
Toolchain-owned boot probe package
        ↓
real disposable DSH boot
        ↓
Host Service assertions (root Host context)
        +
Agent Tool assertions (one owned Agent capability catalog)
        ↓
PASS/FAIL visibility marker
        ↓
appExit(0)
        ↓
worker visibility stage + shared reducer
```

The verifier must not create a second DSH process, call back into the user's active DSH, or reuse a caller Agent.

## Agent epoch

When at least one `agent-tool` assertion exists, the generated boot probe performs one Agent epoch inside the current disposable boot:

1. obtain the live Tool runtime and agent loop through the injected probe scope;
2. create one Toolchain-owned Agent through the synchronous `agentLoop.create(...)` with a deterministic verifier-owned id;
3. call `ctx.tools.schemas(agent)` exactly once to materialize the Agent capability catalog for the assertion batch;
4. require every requested `agent-tool` name to appear in that catalog;
5. never retain the Agent beyond the disposable boot process; worker teardown owns Agent lifetime.

The verifier does not drive a model turn. Tool visibility is the only claim.

If no `agent-tool` assertion exists, no Agent is created. Host Service-only verification therefore preserves the M4.3.1 runtime behavior and side-effect envelope.

## Agent identity

The probe creates its Agent through `agentLoop.create(id)` with a deterministic verifier-owned id (`dsh-toolchain-verify-agent-<profile>`). A fresh disposable DSH home per verification makes collisions impossible; no UUID import is needed in the generated probe.

The id is not part of the public verification receipt, target identity, lifecycle identity, or artifact identity.

## Visibility semantics

### Host Service

Existing semantics remain unchanged:

```ts
rootCtx.get(assertion.name, false) !== undefined
```

### Agent Tool

The authoritative predicate is membership in the exact Agent capability schema set:

```ts
ctx.tools.schemas(agent).some(schema => schema.name === assertion.name)
```

This intentionally proves capability visibility, not model-presentation form. A PTC presentation may collapse what is sent directly to the model while the underlying Agent capability catalog still contains the callable tools. That distinction matches upstream ToolRuntime semantics.

## Failure semantics

The outer `visibility` stage and stable diagnostic remain shared:

- all requested assertions proven: `visibility = passed`;
- any requested Host Service or Agent Tool missing: `visibility = failed`, diagnostic `VERIFY_VISIBILITY_FAILED`;
- Agent creation fails, the agent seam is unavailable, or the Tool catalog cannot be read: visibility is not proven and therefore fails;
- the probe cannot execute an unambiguous visibility outcome at all: existing `visibility-assertions-not-executed` / `VERIFY_VISIBILITY_UNPROVEN` reduction remains applicable.

Agent lifecycle failures are not reclassified as a successful boot assertion. Boot has already been proven by the exact boot marker; the missing proof is visibility.

The diagnostic summary becomes assertion-kind-neutral. No new report status or transport failure is introduced for an expected missing capability.

## Probe marker version

The boot marker remains `DSH_TOOLCHAIN_VERIFY_BOOT_PROBE_V1` because boot semantics do not change.

The visibility marker moves to `DSH_TOOLCHAIN_VERIFY_VISIBILITY_PROBE_V2` because the payload semantics now cover two assertion kinds and an owned Agent lifecycle. This prevents an older Host-Service-only probe marker from being misinterpreted as evidence for Agent Tool visibility.

## Cleanup and ownership

There are two cleanup layers and both remain material:

1. in-process Agent lifetime: the created Agent has no exact-handle disposal on this seam and never outlives the disposable boot process; emitting the visibility marker before `appExit(0)` keeps the claim inside that boundary;
2. worker cleanup: the disposable verification root must still be removed and reported through existing `VerificationReport.cleanup`.

A process kill/cancellation remains covered by the worker process boundary. The disposable DSH process may be terminated before in-process teardown completes, so cancellation still yields the existing cancelled/fail-closed result rather than an Agent Tool visibility claim.

## Frontend parity

The same canonical Protocol request must be projectable through every current frontend:

- CLI: existing repeatable `--visibility-service`; add repeatable `--visibility-tool` mapped to `kind: 'agent-tool'`;
- native DSH Tool: parameter schema accepts both closed kinds;
- MCP: canonical Protocol schema automatically exposes both kinds;
- kernel/execution port: no new semantic branch; the existing assertion array is forwarded unchanged.

CLI combines service assertions first and tool assertions second. Assertion order is not part of the visibility truth claim; `(kind,name)` identity is.

## Real-DSH acceptance

Primary CI must exercise the installed public CLI against registry `@deepseek-ai/dsh@0.1.2-rc.1` in disposable state.

The acceptance fixture must include:

1. a candidate that registers a minimal valid Tool through the live `ctx.tools` runtime (the candidate declares `export const inject = ['tools']`; without it the registration never becomes visible);
2. `plugin verify --profile web --visibility-tool <present-name>` yielding a verified report with `visibility=passed`;
3. the same boot-valid candidate checked for an intentionally absent Tool, yielding semantic `failed` with `boot=passed`, `visibility=failed`, `VERIFY_VISIBILITY_FAILED`;
4. exact artifact/target/lifecycle binding, cleanup success, and unchanged active profile in both paths.

Agent-capability runs resolve the agent-capable `web` profile: the minimal `headless` composition registers no agent loop, so Agent Tool assertions against it fail closed. The candidate Tool body need not be invoked. The test proves visibility only.

## Rejected alternatives

### Query the global Tool registry without an Agent

Rejected. It cannot prove scoped registrations/restrictions and contradicts upstream `Tool/listTools` Agent semantics.

### Reuse the caller's Agent

Rejected. `plugin.verify` runs in a disposable DSH composition and must not bind a claim to mutable state in the user's active process.

### Add a second Cordis Inspect client inside the worker

Rejected for this slice. Upstream `Tool/listTools` delegates directly to `ctx.tools.schemas(context.agent)`; using that same authoritative runtime API inside the owned boot probe avoids a second transport and identity surface without weakening the claim.

### Execute the Tool

Rejected. Tool execution would introduce arguments, guards, approval, side effects, cancellation, result schemas, and behavior semantics. That belongs to a future behavior assertion vocabulary.

### Client/page visibility next

Deferred. Client capability evidence still requires a deterministic page identity/lifetime contract before a content-addressed verification claim is safe.

## Non-goals

- Tool execution or behavioral correctness;
- Client/page visibility;
- generic behavior assertion vocabulary;
- operation/progress lifecycle;
- trusted execution or malicious-code sandboxing;
- Search/ranker/H1/H2 changes;
- target, lifecycle, Contract Index, or artifact fingerprint namespace changes.