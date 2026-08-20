import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@demo/ui", "@demo/foundry-client"],
  serverExternalPackages: ["better-sqlite3"],
  // The whole codebase writes internal imports as `./foo.js` (correct Node
  // ESM specifier form for a `./foo.ts` source file — needed so vitest and
  // tsc's "bundler" moduleResolution agree). Next's webpack build does not
  // resolve that, and fails every such import with "Module not found" unless
  // told to also try `.ts`/`.tsx` when a `.js` specifier doesn't resolve.
  //
  // Turbopack does NOT resolve it natively either, contrary to what this
  // comment used to claim: `next dev --turbopack` compiles cleanly and then
  // dies at runtime with `Cannot find module './env.js'` from
  // instrumentation's dynamic import, because `extensionAlias` is a
  // webpack-only option. Measured on Next 15.5.22.
  webpack(config, { nextRuntime, webpack }) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };

    // Next compiles `src/instrumentation.ts` for the EDGE runtime as well as
    // node — unconditionally, even though this app has no middleware and no
    // edge route, so that bundle is never executed. Its build still fails,
    // and in dev a stored compiler error is served for EVERY route, which is
    // why `pnpm dev` used to answer 500 everywhere while the node server had
    // in fact booted and seeded fine.
    //
    // `serverExternalPackages` does not apply to the edge compiler, and
    // stubbing the offending node builtins is unbounded whack-a-mole: hiding
    // `fs` (from better-sqlite3) merely promotes `node:crypto` (from
    // src/lib/password.ts via src/db/seed.ts) to the next failure. So cut the
    // edge graph at OUR module boundary instead — the two specifiers
    // instrumentation dynamically imports. `register()` guards on
    // NEXT_RUNTIME, so nothing ever calls into these empty stubs.
    if (nextRuntime === "edge") {
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /^\.\/db\/(index|seed)\.js$/,
        }),
      );
    }

    return config;
  },
};

export default nextConfig;