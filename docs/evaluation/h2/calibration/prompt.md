# Calibration task: make the plugin load again

This is a public, non-scoring H2 calibration task. It exists so the H2 harness can be exercised
end to end (fresh DSH home, real DSH `acp` profile, DeepSeek V4.1 Flash, Agent tools, workspace
change, independent grader) before any hidden task is scored.

The plugin in this workspace does not load: DSH cannot parse its entry module, so the composition
never starts and the `calibrationWidget` service is never mounted.

Fix `index.mjs` so the plugin loads and registers its `calibrationWidget` service, keeping the
logging call and the service behaviour unchanged. If your environment exposes the DSH Toolchain
tools (`toolchain_target_resolve`, `toolchain_contract_search`, `toolchain_contract_inspect`),
you may use them to confirm the installed harness surface before you edit the plugin.
