import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    env: { DATABASE_URL: "file:./test.db", AUTH_SECRET: "test-secret-test-secret-test-secret" },
    fileParallelism: false,
    testTimeout: 30000,
  },
});
