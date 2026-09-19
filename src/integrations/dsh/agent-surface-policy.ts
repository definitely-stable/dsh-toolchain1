/**
 * Which Toolchain operations the native DSH integration advertises as Agent Tools.
 *
 * The complete application surface and the default model-visible surface are two
 * different things, and conflating them is what made the post-H2 integration expensive.
 * The kernel owns eight transport-neutral operations; every one of them stays reachable
 * through the `ctx.toolchain` service, the CLI, MCP and the Web frontends. Only a subset
 * is advertised to a coding Agent by default, because an Agent Tool costs model context
 * on every turn — its name, description and parameter schema — whether or not the Agent
 * ever calls it.
 *
 * H2 measured that cost directly. Across all 36 scoring observations the Agent never once
 * called `toolchain_plugin_verify_start`, `toolchain_operation_get` or
 * `toolchain_operation_cancel`, yet their schemas were advertised in every Arm C turn.
 * The asynchronous lifecycle is genuinely useful to a persistent Host, Web or MCP client
 * that polls an operation; it has no measured use in a bounded coding task, where the
 * synchronous `plugin.verify` already answers the same question.
 *
 * This list is the policy, and `OMITTED_FROM_DEFAULT_AGENT_SURFACE` below is the
 * complement that keeps the intent explicit. Adding a tool means editing both.
 */
export const DEFAULT_AGENT_TOOL_NAMES = Object.freeze([
  'toolchain_target_resolve',
  'toolchain_contract_search',
  'toolchain_contract_inspect',
  'toolchain_plugin_check',
  'toolchain_plugin_verify',
] as const)

/**
 * Operations implemented and tested but deliberately not advertised by default.
 *
 * They are *withheld*, not removed: the definitions still exist, the service methods
 * that back them are unchanged, and a persistent frontend that wants them can register
 * them from the same factories. Because omitting a tool is now a decision in a list
 * rather than the absence of a line, a newly added operation cannot silently become
 * model-visible without someone editing this policy.
 */
export const OMITTED_FROM_DEFAULT_AGENT_SURFACE = Object.freeze([
  'toolchain_plugin_verify_start',
  'toolchain_operation_get',
  'toolchain_operation_cancel',
] as const)

export type DefaultAgentToolName = (typeof DEFAULT_AGENT_TOOL_NAMES)[number]
export type WithheldAgentToolName = (typeof OMITTED_FROM_DEFAULT_AGENT_SURFACE)[number]

/**
 * Does the default surface advertise this tool? Used as the registration filter, so the
 * policy is the single source of truth rather than a duplicated conditional.
 */
export function isDefaultAgentTool(name: string): boolean {
  return (DEFAULT_AGENT_TOOL_NAMES as readonly string[]).includes(name)
}
