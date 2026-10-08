// Separate from the normal test run on purpose: this calls the REAL Anthropic
// API and costs real money, so it never runs as part of `npm test`.
//   ANTHROPIC_API_KEY=sk-ant-... npm run eval:coach
// Optional: EVAL_BUDGET_USD=1.50 (hard stop), EVAL_ONLY="pull,undo" (subset).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["evals/**/*.eval.jsx"],
    environment: "jsdom",
    globals: true,
    testTimeout: 120000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
