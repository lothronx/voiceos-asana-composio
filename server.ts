/**
 * MCP entry point that VoiceOS launches via run.sh (stdio; stdout is the MCP
 * wire, so log with console.error). This file only wires things together:
 *
 *   src/composio.ts  HTTP client for Composio
 *   src/asana.ts     Asana operations on top of it
 *   src/cards.ts     the notch cards for create_task's result
 *
 * Tool names, descriptions and input schemas must stay identical to
 * voiceos.integration.json — VoiceOS routes and confirms from the manifest.
 * This file must stay at the folder root: run.sh launches it by that path.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createComposioExecutor } from "./src/composio.ts";
import { createAsana, type NewTask } from "./src/asana.ts";
import { errorCard, glance, successCard } from "./src/cards.ts";

// Settings the user entered in VoiceOS arrive as env vars named after each manifest preference.
const asana = createAsana(
  createComposioExecutor({
    apiKey: process.env.COMPOSIO_API_KEY?.trim(),
    userId: process.env.COMPOSIO_ENTITY_ID?.trim() || "default",
  }),
  { workspaceGid: process.env.ASANA_WORKSPACE_GID?.trim() || undefined },
);

const server = new McpServer({ name: "asana-tasks", version: "1.0.0" });

/** A tool result: JSON the model reads (plus `_voiceos_glance` when the notch should show a card). */
const textResult = (payload: unknown, isError = false) => ({
  ...(isError ? { isError: true } : {}),
  content: [{ type: "text" as const, text: JSON.stringify(payload) }],
});

/** Turns a failure into words the user can act on. */
function describeError(err: any): string {
  // A timed-out create may still have reached Asana; retrying blindly would duplicate the task.
  if (err?.name === "TimeoutError") {
    return "Composio did not answer in time. The task may still have been created — check Asana before retrying.";
  }
  return err?.message || "Network error while connecting to Composio.";
}

server.registerTool(
  "list_asana_options",
  {
    title: "List Asana projects and sections",
    description: "List the user's Asana projects and their My Tasks sections (e.g. Recently assigned / Today / Next week / Later — users can rename or add their own). Always call this right before create_task and pass the results as project_choices and section_choices. Also use when the user asks which Asana projects or My Tasks sections they have.",
    inputSchema: {} as any,
  },
  // No glance card: this is a silent lookup step before create_task's confirmation card.
  async () => textResult(await asana.listOptions()),
);

const choiceSchema = z.array(z.object({ gid: z.string(), name: z.string() }));

server.registerTool(
  "create_task",
  {
    title: "Create task",
    description: "Create a new task assigned to the user in Asana My Tasks via Composio. Use when the user asks to create, add, or schedule a task or todo in Asana. First call list_asana_options and pass its projects and sections as project_choices and section_choices so the user can pick them on the confirmation card. Set project / section only when the user named one, using its gid.",
    inputSchema: {
      name: z.string().describe("Task name or title"),
      due_on: z.string().optional().describe("Optional due date, YYYY-MM-DD"),
      due_time: z.string().optional().describe("Optional due time in the user's local time, 24h HH:MM; requires due_on"),
      project: z.string().optional().describe("Optional project gid from list_asana_options"),
      section: z.string().optional().describe("Optional My Tasks section gid from list_asana_options"),
      // Only the confirmation card reads these (to fill its dropdowns); the handler ignores project_choices.
      project_choices: choiceSchema.optional().describe("The projects array returned by list_asana_options, passed through unchanged"),
      section_choices: choiceSchema.optional().describe("The sections array returned by list_asana_options, passed through unchanged"),
    } as any,
  },
  async (args: NewTask) => {
    try {
      const result = await asana.createTask(args);
      return textResult({ success: true, ...result, _voiceos_glance: glance(successCard(result)) });
    } catch (err: any) {
      console.error("create_task failed:", err);
      const error = describeError(err);
      return textResult({ error, taskName: args.name, _voiceos_glance: glance(errorCard(args.name, error)) }, true);
    }
  },
);

await server.connect(new StdioServerTransport());
