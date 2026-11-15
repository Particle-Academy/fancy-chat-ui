import { defineConfig } from "vitest/config";

// The end-to-end run: the real transport and store against fancy-chat-php's
// harness (`php -S ... tests/e2e/serve.php`). Separate from `npm test` because it
// needs PHP and a fancy-chat-php checkout; `npm run test:e2e` FAILS (never skips)
// when either is missing, so a green run always means it ran.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.e2e.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
