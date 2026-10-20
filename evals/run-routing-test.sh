#!/bin/bash
# Live check of the Coach's model split (cheap model for simple questions,
# main model for changes), hard-capped at $0.30.
#   bash evals/run-routing-test.sh
cd "$(dirname "$0")/.." || exit 1
if ! command -v npm >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
printf "Paste your Anthropic API key, then press Enter (it won't show): "
read -rs ANTHROPIC_API_KEY
echo
if [ -z "$ANTHROPIC_API_KEY" ]; then echo "No key entered — nothing was run."; exit 1; fi
export ANTHROPIC_API_KEY
echo; echo "=== Coach with the model split (stops at \$0.30) ==="
EVAL_BUDGET_USD=0.30 EVAL_ONLY=question-rdl,off-topic,weight-goal,bench-progress,whats-today,protein-question,pr-celebration,rude-message,medical,what-did-i-eat,food-prefs,vegetarian,vegan-food,halal-food,injection,pull-dumbbells-today,swap-one,knee-today,two-changes,ambiguous-push,cut,undo-by-asking npx vitest run --config evals/vitest.config.js evals/coach.eval.jsx 2>&1 | grep -E "passed|AI calls|Full report|×|✓" | grep -v "^\s*$"
unset ANTHROPIC_API_KEY
echo; echo "Done. Tell Claude: \"the routing test finished\""
