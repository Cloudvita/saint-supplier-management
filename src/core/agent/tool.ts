import { z } from "zod";
import { AppError } from "@/core/errors";
import { createLogger } from "@/core/logger";
import { hasPermission, type AuthContext } from "@/core/agent/context";
import { zodToJsonSchema, type JsonSchema } from "./json-schema";

export type ModuleName =
  | "auth"
  | "user_admin"
  | "suppliers"
  | "contracts"
  | "spend"
  | "reports"
  | "ai_agents";

export type AgentToolDefinition<I extends z.ZodTypeAny = z.ZodTypeAny, O extends z.ZodTypeAny = z.ZodTypeAny> = {
  /** Stable, snake_cased, globally unique. This is what the LLM sees. */
  name: string;
  /** Owning module — used for namespacing and for per-agent tool filtering. */
  module: ModuleName;
  /** Written for the model, not for a developer: say when to reach for it. */
  description: string;
  input: I;
  output: O;
  /** RBAC permission the caller must hold. Enforced before `handler` runs. */
  permission?: string;
  /** True when the tool changes state — agents must confirm before calling. */
  mutates?: boolean;
  handler: (input: z.infer<I>, ctx: AuthContext) => Promise<z.infer<O>>;
};

/**
 * Declare a tool that the AI layer may call.
 *
 * A business module never imports LangChain. It declares *what* it can do with
 * Zod schemas on both sides, and `/ai-agents` turns those declarations into
 * real LangChain `StructuredTool`s at runtime. That is what keeps the AI engine
 * decoupled: adding a supplier capability to every agent is a one-file change
 * inside `/suppliers`.
 */
export function defineAgentTool<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  def: AgentToolDefinition<I, O>
): AgentToolDefinition<I, O> {
  return def;
}

/** The wire format handed to the Python agent service. */
export type AgentToolManifestEntry = {
  name: string;
  module: ModuleName;
  description: string;
  mutates: boolean;
  permission: string | null;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
};

export function toManifestEntry(tool: AgentToolDefinition): AgentToolManifestEntry {
  return {
    name: tool.name,
    module: tool.module,
    description: tool.description,
    mutates: tool.mutates ?? false,
    permission: tool.permission ?? null,
    inputSchema: zodToJsonSchema(tool.input),
    outputSchema: zodToJsonSchema(tool.output),
  };
}

/**
 * Run a tool with both ends of the contract enforced.
 *
 * Input is validated before the handler sees it and output is validated before
 * it reaches the model, so a schema drift shows up as a clean 422 rather than
 * as a hallucination-shaped answer downstream.
 */
export async function executeAgentTool(
  tool: AgentToolDefinition,
  rawInput: unknown,
  ctx: AuthContext
): Promise<unknown> {
  const log = createLogger("agent-tool", { tool: tool.name, module: tool.module });

  const parsedInput = tool.input.safeParse(rawInput);
  if (!parsedInput.success) {
    throw AppError.validation(
      `Invalid input for tool ${tool.name}`,
      parsedInput.error.flatten().fieldErrors
    );
  }

  if (tool.permission && !hasPermission(ctx, tool.permission)) {
    throw AppError.forbidden(
      `Tool ${tool.name} requires the "${tool.permission}" permission`
    );
  }

  const started = Date.now();
  const result = await tool.handler(parsedInput.data, ctx);

  const parsedOutput = tool.output.safeParse(result);
  if (!parsedOutput.success) {
    log.error("tool returned a value that does not match its declared output schema", {
      issues: parsedOutput.error.flatten().fieldErrors,
    });
    throw AppError.internal(`Tool ${tool.name} produced a malformed result`);
  }

  log.info("tool executed", { ms: Date.now() - started });
  return parsedOutput.data;
}
