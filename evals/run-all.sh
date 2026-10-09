#!/bin/bash
# Runs the Coach test list two ways against the real AI: as shipped, and with
# the shorter (cheaper) rulebook, to decide whether to switch that on.
#   bash evals/run-all.sh
# Asks for the Anthropic API key (typing is hidden; it is never saved).
# Each pass stops itself at $1.25, so the most this can ever cost is $2.50.
cd "$(dirname "$0")/.." || exit 1
if ! command -v npm >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
if ! command -v npm >/dev/null 2>&1; then echo "Couldn't find npm. Ask Claude for help."; exit 1; fi

printf "Paste your Anthropic API key, then press Enter (it won't show): "
read -rs ANTHROPIC_API_KEY
echo
if [ -z "$ANTHROPIC_API_KEY" ]; then echo "No key entered — nothing was run."; exit 1; fi
export ANTHROPIC_API_KEY
export EVAL_BUDGET_USD=1.25

echo; echo "=== 1/2: the Coach as it is now (replies stream in) ==="
npm run eval:coach 2>&1 | grep -E "passed|AI calls|Full report|×|✓" | grep -v "^\s*$"
echo; echo "=== 2/2: with the shorter rulebook ==="
EVAL_PROMPT=compact npm run eval:coach 2>&1 | grep -E "passed|AI calls|Full report|×|✓" | grep -v "^\s*$"

unset ANTHROPIC_API_KEY
echo; echo "Done. Tell Claude: \"the tests finished\" — the reports are in evals/results/."
