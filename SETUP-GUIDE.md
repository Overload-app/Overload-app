# Overload: your setup guide (no Claude Code needed)

This is everything you need to keep working on Overload with regular Claude (claude.ai) after Claude Code is gone. Do Part A once. Part B is what you do every time you want a change.

---

## Part A: one-time setup (about 20 minutes)

### A1. Things already done ✅
- Supabase: the AI spending limit and tester device lock (the 2 SQL files) are switched on.
- GitHub: the 6pm workout reminders file is added and tested.
- Your own account is set as subscribed.

### A2. Delete the API key from the chat (2 minutes)
1. Go to **console.anthropic.com** and sign in.
2. Click **API Keys** on the left.
3. Find the key you created for testing (not the one the app uses) and click the **⋯** or trash icon → **Delete**.

The app keeps working, because it uses a different key saved in Vercel.

### A3. Install VS Code, a free editor that's easier than TextEdit (5 minutes)
1. Go to **code.visualstudio.com** and click **Download for Mac**.
2. Open the download and drag **Visual Studio Code** into your **Applications** folder.
3. Open it. Click **File → Open Folder…**, go to **Downloads → physique-coach-web 25** and click **Open**. If it asks "Do you trust the authors?", click **Yes**.
4. You'll see all the app's files on the left. That's where you'll make changes.

### A4. Learn the 2 Terminal commands you'll use (3 minutes)
1. Open **Terminal**: press Cmd+Space, type **Terminal**, press Enter.
2. Go to the project folder. Copy this, paste it, and press Enter:
   ```
   cd ~/Downloads/"physique-coach-web 25"
   ```
3. To put a change live:
   ```
   bash ship.sh "describe the change here"
   ```
   It takes 2–4 minutes. It runs every test, builds the app, saves to GitHub, deploys to the website and checks it worked.
   - **✅ Live** at the end means it worked.
   - **❌ Some tests failed** means nothing went live. Copy the red lines and paste them to Claude.
   - **Not authorized** means run `npx vercel@63.1.0 login`, approve in your browser, then run ship.sh again.

You can also open a Terminal inside VS Code (**Terminal → New Terminal** at the top). It starts in the project folder automatically.

### A5. Set up Claude (5 minutes)
1. Go to **claude.ai** and sign in.
2. If you see **Projects** on the left, click it → **Create project** → name it "Overload". Otherwise just start a **New chat**.
3. Upload **HANDOFF-FOR-CLAUDE.md** (from your project folder) into the project's files, or attach it to the chat.
4. Send this as your first message: *"Read HANDOFF-FOR-CLAUDE.md. You're my developer for Overload — continue from where it leaves off."*

**Don't upload the zip or the whole `src/App.jsx`.** App.jsx is too big for a chat (about 170,000 tokens). Claude will ask you to paste the specific part it needs.

---

## Part B: making a change (every time)

1. **Tell Claude what you want**, like before. For example: *"The rest timer sound is too quiet"* or *"Add a button to share my PRs"*.
2. **If Claude asks to see code,** it will name something, e.g. *"paste the `RestTimer` function from src/App.jsx"*.
   - In VS Code, open the file, press **Cmd+F**, type the name (e.g. `function RestTimer`), and copy that whole section.
   - Paste it to Claude.
3. **Claude gives you "find this → replace with this".**
   - Open the file it names in VS Code.
   - Press **Cmd+F** and paste the **"find"** text. It should highlight exactly one match. If it finds 0 or 2+, tell Claude.
   - Close the search box. The found text stays selected.
   - Paste the **"replace with"** text over it.
   - Press **Cmd+S** to save.
   - For a brand-new file: **File → New File**, paste, then **Cmd+S** and save it where Claude says.
4. **Put it live:** in Terminal (in the project folder), run:
   ```
   bash ship.sh "short description of the change"
   ```
5. **Check it on your phone.** Close the app fully and reopen it to get the new version.

### If something goes wrong
- **Tests fail:** nothing went live and the site is safe. Paste the red lines to Claude; it will fix them.
- **You made a mistake editing:** in VS Code, press **Cmd+Z** to undo, or ask Claude to send the change again.
- **You need to undo a change that's already live:** tell Claude *"undo my last change"*. It can walk you through `git revert`.
- **The app looks old on your phone:** close it completely (swipe it away) and reopen. The new version loads on the next launch.

---

## Things you might need later

- **Give a tester a new phone:** Supabase → **SQL Editor** → New query → run (change 3 to their number):
  ```
  delete from public.tester_devices where tester = 3;
  ```
- **Tester passwords:** in `tester-passwords.txt` (keep it private; never upload it).
- **Launch to the public:** tell Claude *"turn off the tester gate"*. That changes `DEV_GATE_ENABLED` to `false` in `src/DevGate.jsx`; then run ship.sh.
- **See errors from real users:** Supabase → **Table Editor** → `error_logs`.
- **Check the reminders are running:** GitHub → your repo → **Actions** → **Workout reminders**. Green ✓ means good.
- **AI costs:** console.anthropic.com → **Usage**.
- **When you come back to Claude Pro / Claude Code:** open the same folder in Claude Code. Everything carries on from here.
