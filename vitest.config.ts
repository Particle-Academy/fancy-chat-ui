import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // The e2e run needs PHP and the fancy-chat-php harness: `npm run test:e2e`.
    exclude: ["tests/e2e/**", "node_modules/**"],
    restoreMocks: true,
    setupFiles: ["tests/setup.ts"],
  },
  oxc: {
    jsx: { runtime: "automatic" },
  },
});
