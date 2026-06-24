// Vercel AI SDK ModelProvider. Maps an AIM model step to a SINGLE SDK call:
// generateObject when the output contract is JSON-with-schema, generateText
// otherwise. The framework's tool loop is never engaged — multi-step logic
// belongs in the AIM plan, not in the model call (§13.3).

import { generateObject, generateText, jsonSchema, type LanguageModel } from "ai";
import type { Json, ModelProvider } from "@aim/core";

export interface VercelProviderOptions {
  // A configured Vercel AI SDK model instance (e.g. openai("gpt-4o"),
  // anthropic("claude-..."), etc.). AIM stays provider-agnostic above this.
  model: LanguageModel;
  // Resolves a named output schema (prompt.output.schema) to a JSON Schema
  // object so the SDK can enforce structured output (§13.4 rule 3).
  resolveSchema?: (name: string) => Json | undefined;
}

export function createVercelModelProvider(opts: VercelProviderOptions): ModelProvider {
  return {
    async generate(req) {
      // JSON + named schema → native structured output (single call).
      if (req.output.format === "json" && req.output.schema) {
        const name = typeof req.output.schema === "string" ? req.output.schema : undefined;
        const schemaObj = name ? opts.resolveSchema?.(name) : (req.output.schema as Json);
        if (schemaObj) {
          const { object } = await generateObject({
            model: opts.model,
            schema: jsonSchema(schemaObj as Record<string, unknown>),
            system: req.system,
            prompt: req.prompt
          });
          return { value: object as Json };
        }
      }
      // Fallback: plain text generation (single call).
      const { text } = await generateText({
        model: opts.model,
        system: req.system,
        prompt: req.prompt
      });
      if (req.output.format === "json") {
        try {
          return { value: JSON.parse(text) as Json };
        } catch {
          return { value: text };
        }
      }
      return { value: text };
    }
  };
}
