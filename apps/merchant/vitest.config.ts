import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_PATH: ":memory:",
      FOUNDRY_ADMIN_URL: "http://127.0.0.1:9000",
      FOUNDRY_ADMIN_KEY: "test-admin-key",
      BANK_API_URL: "http://127.0.0.1:3001",
      BANK_API_KEY: "test-bank-key",
      MERCHANT_NAME: "Demo Shop",
      MERCHANT_PAYEE_ID: "Payee-id-123",
      FOUNDRY_WEBHOOK_SECRET: "test-webhook-secret",
    },
  },
  resolve: {
    alias: { "@": new URL("./src/", import.meta.url).pathname },
  },
});
