# DSH Toolchain Agent Skill

This directory is the model-facing operating skill shipped with the `dsh-toolchain` package.

It is separate from repository-internal evaluation skills. Its purpose is to teach a coding agent how to use the installed Toolchain product correctly while developing, reviewing, fixing, or migrating a DeepSeek Harness plugin.

## Use

Agent clients that support the Agent Skills `SKILL.md` convention can import or register this `skills/dsh-toolchain/` directory through their normal skill/plugin mechanism. Keep the directory intact so `SKILL.md` remains the entry point.

The skill does not add runtime capabilities. The installed Toolchain/DSH integration must still expose the relevant operations. The skill teaches the agent how to combine the capabilities that actually exist in that installed version and explicitly forbids inventing future Toolchain commands.

Current canonical workflow:

```text
exact target resolve
    -> contract search
    -> contract inspect
    -> implement/review from evidence
```

Future packaged versions may extend the final steps to Exact Target Plugin Check and isolated verification after those product surfaces are implemented.

## Why it ships with the package

The exact-target workflow has identity rules that are easy for a general coding model to misuse even when tools are visible. In particular:

- target identity and Contract Index identity are distinct;
- inspectable contract IDs come from `search.data.matches[].id`;
- evidence IDs are provenance only;
- declared capability is not the same as observed runtime availability;
- stale evidence must be reacquired rather than guessed around.

Keeping this guidance next to the exact Toolchain version makes the model workflow versionable with the product instead of relying on an unrelated global prompt.