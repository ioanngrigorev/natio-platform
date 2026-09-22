import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      QUEUE_DRIVER: "memory",
      LOG_LEVEL: "silent",
      NATIO_ENCRYPTION_KEY: "0f0e0d0c0b0a09080706050403020100ffeeddccbbaa99887766554433221100",
      NATIO_SESSION_SECRET: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
      COOKIE_SECURE: "false",
      WEBHOOK_ALLOW_PRIVATE_URLS: "true",
    },
  },
});
