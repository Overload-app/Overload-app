#!/bin/bash
# Ship a change to overload-app.com in one go:
#   bash ship.sh "what you changed"
# 1. runs every automated test (stops if any fail — nothing is deployed)
# 2. builds the app (stops if the build fails)
# 3. saves the change to GitHub
# 4. deploys to Vercel (retries, since Vercel sometimes says "Not authorized")
# 5. checks the live site is serving the new version
cd "$(dirname "$0")" || exit 1
if ! command -v npm >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
if ! command -v npm >/dev/null 2>&1; then echo "Couldn't find npm (Node). Install Node from nodejs.org, then try again."; exit 1; fi
MSG="${1:-Update}"

echo "1/5 Running tests…"
if ! npx vitest run > /tmp/overload-tests.log 2>&1; then
  grep -E "×|FAIL|Error" /tmp/overload-tests.log | head -30
  echo; echo "❌ Some tests failed — nothing was deployed. Paste the lines above to Claude."
  exit 1
fi
grep -E "Tests " /tmp/overload-tests.log

echo "2/5 Building…"
if ! npm run build > /tmp/overload-build.log 2>&1; then
  tail -30 /tmp/overload-build.log
  echo; echo "❌ The build failed — nothing was deployed. Paste the lines above to Claude."
  exit 1
fi

echo "3/5 Saving to GitHub…"
git add -A
git reset -q -- tester-passwords.txt .env .env.local 2>/dev/null
git commit -q -m "$MSG" || echo "(nothing new to save)"
git push -q || echo "⚠️  GitHub push failed (you may need to sign in to GitHub). Deploying anyway."

BEFORE=$(curl -s https://www.overload-app.com/ | grep -o 'assets/index-[^"]*\.js' | head -1)
echo "4/5 Deploying to Vercel…"
ok=""
for i in 1 2 3; do
  if npx vercel@63.1.0 --prod --yes --scope fr3dprintinganddesign-ais-projects > /tmp/overload-deploy.log 2>&1 && grep -q "Aliased" /tmp/overload-deploy.log; then ok=1; break; fi
  echo "   retrying ($i)…"
  npx vercel@63.1.0 whoami --scope fr3dprintinganddesign-ais-projects > /dev/null 2>&1
  sleep 3
done
if [ -z "$ok" ]; then
  tail -15 /tmp/overload-deploy.log
  echo; echo "❌ Deploy failed. If it says 'Not authorized', run:  npx vercel@63.1.0 login   then try again."
  exit 1
fi

echo "5/5 Checking the live site…"
sleep 5
AFTER=$(curl -s https://www.overload-app.com/ | grep -o 'assets/index-[^"]*\.js' | head -1)
if [ -z "$AFTER" ]; then echo "⚠️  Couldn't reach www.overload-app.com — check it in your browser.";
elif [ "$AFTER" != "$BEFORE" ]; then echo "✅ Live: www.overload-app.com is serving the new version.";
else echo "✅ Deployed. (The app's main file didn't change — normal if you only changed server/api files.)"; fi
