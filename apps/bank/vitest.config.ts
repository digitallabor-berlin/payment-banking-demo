import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_PATH: ":memory:",
      FOUNDRY_ADMIN_URL: "http://127.0.0.1:9000",
      FOUNDRY_ADMIN_KEY: "test-admin-key",
      BANK_API_KEY: "test-bank-key",
      SESSION_SECRET: "test-secret-0123456789012345678901234567890123",
    },
  },
  resolve: {
    alias: { "@": new URL("./src/", import.meta.url).pathname },
  },
});