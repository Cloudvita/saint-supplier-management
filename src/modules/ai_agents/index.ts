/**
 * `/ai-agents` — the AI engine: tool registry, mode routing and the gateway to
 * the Python LangGraph service.
 *
 * Owns no tables and no business rules. Its only knowledge of the domain is
 * whatever the other modules chose to publish through `defineAgentTool`, which
 * is what lets a supplier or contract capability reach every agent without the
 * engine changing at all.
 */
export {
  listAgentTools,
  buildToolManifest,
  getAgentTool,
  invokeAgentTool,
  resetRegistry,
} from "./services/registry";

export {
  streamAgentRun,
  runAgent,
  resolveMode,
  agentServiceHealth,
  extractOntologyTriples,
  answerFromGraph,
  type AgentRunRequest,
} from "./services/agent-gateway";

export {
  AGENT_MODES,
  AGENT_MODE_KEYS,
  routeMode,
  type AgentMode,
  type ModeDefinition,
} from "./domain/modes";
