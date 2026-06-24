// Flat ESLint config. The central portability guard: @aim/core and the adapter
// MUST NOT import node:* / Buffer / process, so the kernel stays runnable on
// Deno (Supabase Edge) and Cloudflare Workers, not just Node.
import tseslint from "typescript-eslint";

const portabilityGuard = {
  files: ["packages/core/src/**/*.ts", "packages/adapter-reference/src/**/*.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          { group: ["node:*", "fs", "path", "crypto", "os", "stream", "buffer"], message: "Core/adapter must stay runtime-neutral. Move Node-specific code into host-node and inject it via a port (ports.ts)." }
        ]
      }
    ],
    "no-restricted-globals": [
      "error",
      { name: "process", message: "Use an injected port instead of process in the portable kernel." },
      { name: "Buffer", message: "Use Uint8Array/TextEncoder instead of Buffer in the portable kernel." },
      { name: "__dirname", message: "Not available off-Node." },
      { name: "require", message: "ESM only." }
    ]
  }
};

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/validate/generated/**"]
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }
      ]
    }
  },
  portabilityGuard
);
