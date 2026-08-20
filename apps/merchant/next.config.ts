import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@demo/ui", "@demo/foundry-client"],
  serverExternalPackages: ["better-sqlite3"],
  webpack(config, { nextRuntime, webpack }) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };

    // Next compiles `src/instrumentation.ts` for the edge runtime too, even
    // though this app has no middleware and no edge route, so that bundle is
    // never executed — but its build failure is still served for every route
    // in dev. Cut the edge graph at our own db boundary; stubbing the node
    // builtins underneath it is unbounded whack-a-mole. See the bank's
    // next.config.ts for the full reasoning.
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