import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only this plugin's own tests — exclude the (gitignored) reference
    // clones a scaffolding pass may have checked out under _ref/.
    include: ["test/**/*.test.ts"],
  },
});
