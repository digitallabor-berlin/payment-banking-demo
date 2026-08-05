import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@demo/ui", "@demo/foundry-client"],
  serverExternalPackages: ["better-sqlite3"],
  // The whole codebase writes internal imports as `./foo.js` (correct Node
  // ESM specifier form for a `./foo.ts` source file — needed so vitest and
  // tsc's "bundler" moduleResolution agree). Turbopack resolves this mapping
  // natively; Next's webpack build (used for `next build`) does not, and
  // fails every such import with "Module not found" unless told to also try
  // `.ts`/`.tsx` when a `.js` specifier doesn't resolve.
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;