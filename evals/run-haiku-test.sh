#!/bin/bash
# Coach test on Claude Haiku 5.5 vs the current model, under $2 total.
#   bash evals/run-haiku-test.sh
# Asks for an Anthropic API key (typing is hidden; never saved anywhere).
cd "$(dirname "$0")/.." || exit 1
if ! command -v npm >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
printf "Paste your Anthropic API key, then press Enter (it won't show): "
read -rs ANTHROPIC_API_KEY
echo
if [ -z "$ANTHROPIC_API_KEY" ]; then echo "No key entered — nothing was run."; exit 1; fi
export ANTHROPIC_API_KEY
echo; echo "=== 1/2: Coach on Claude Haiku 5.5 (stops at \$0.50) ==="
EVAL_MODEL=claude-haiku-5-5 EVAL_BUDGET_USD=0.50 npx vitest run --config evals/vitest.config.js evals/coach.eval.jsx 2>&1 | grep -E "passed|AI calls|Full report|×|✓" | grep -v "^\s*$"
echo; echo "=== 2/2: Coach on the current model, for comparison (stops at \$1.30) ==="
EVAL_BUDGET_USD=1.30 npx vitest run --config evals/vitest.config.js evals/coach.eval.jsx 2>&1 | grep -E "passed|AI calls|Full report|×|✓" | grep -v "^\s*$"
unset ANTHROPIC_API_KEY
echo; echo "Done. Tell Claude: \"the haiku test finished\""
