## Why

Explain the problem, constraint, or opportunity that makes this change necessary.

## What

Summarize the behavior or structure changed. Keep this to the coherent reason this PR exists.

## Contract / architecture impact

List affected specs, schemas, diagnostic codes, public APIs, ADRs, or write `None`.

## Verification

List the exact checks actually executed and their observed result. Do not list checks that were not run.

```text
command-or-check: result
```

## Risks

Call out remaining compatibility, lifecycle, security, packaging, performance, or platform risks. Write `None identified` only after considering these boundaries.

## Related

Fixes #
Depends on #

---

Author checklist:

- [ ] PR title follows Conventional Commits (`type(scope): description`).
- [ ] The PR has one coherent reason to exist and contains no unrelated cleanup.
- [ ] Public contract changes update spec + schema + examples + tests/generated outputs together.
- [ ] Comments explain non-obvious why/constraints rather than restating code.
- [ ] Generated files, if any, were regenerated from their source and not hand-edited.
- [ ] I reviewed the final diff and recorded only verification that was actually executed.
