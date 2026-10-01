import React, { useState } from "react";

// Real ask: while the app isn't finished, anyone visiting the site should see
// "under development, available soon", and only testers with the password get
// in. Turn this off at launch by setting DEV_GATE_ENABLED to false.
export const DEV_GATE_ENABLED = true;

// The password is stored only as a SHA-256 hash. The site's JavaScript can be
// downloaded and read by anyone, so the password itself must never appear in
// this code (or anywhere else in the repo, tests included).
//
// What this is and isn't: it keeps the unfinished app away from people who
// find the link — e.g. from a video. It is not real security; someone
// technical could get past a check that runs in their own browser. Nothing
// that needs protecting depends on it: every account's data is still behind
// its own sign-in, and the AI endpoint still requires a signed-in session.
export const TESTER_PASSWORD_HASH = "d105c31c847ee5f1c7e419134babbdbe2673ea09eb4823f1ff806b35d144473f";

const UNLOCK_KEY = "overload_tester_unlocked";

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readUnlocked() {
  try { return localStorage.getItem(UNLOCK_KEY) === "1"; } catch (e) { return false; }
}

export function DevGate({ children, enabled = DEV_GATE_ENABLED, passwordHash = TESTER_PASSWORD_HASH }) {
  const [unlocked, setUnlocked] = useState(() => !enabled || readUnlocked());
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  if (unlocked) return children;

  async function submit(e) {
    e.preventDefault();
    if (!value || checking) return;
    setChecking(true);
    setError("");
    // Trimmed because a phone keyboard can tack on a trailing space; case is
    // left alone.
    const hash = await sha256Hex(value.trim());
    setChecking(false);
    if (hash === passwordHash) {
      try { localStorage.setItem(UNLOCK_KEY, "1"); } catch (err) {}
      setUnlocked(true);
    } else {
      setError("That's not the right password.");
      setValue("");
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, boxSizing: "border-box", fontFamily: "'Inter', sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 360, textAlign: "center" }}>
        <img src="/icon-192.png" alt="Overload" width={64} height={64} style={{ borderRadius: 16, marginBottom: 20 }} />
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 700, color: "#0D0E15", margin: "0 0 8px" }}>
          Coming soon
        </h1>
        <p style={{ fontSize: 15, color: "#5B6470", lineHeight: 1.5, margin: "0 0 28px" }}>
          This site is under development and will be available soon.
        </p>
        <form onSubmit={submit} style={{ textAlign: "left" }}>
          <label htmlFor="tester-password" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#0D0E15", marginBottom: 6 }}>
            If you're a tester, enter the password
          </label>
          <input
            id="tester-password"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            style={{ width: "100%", padding: "14px 16px", fontSize: 16, borderRadius: 12, border: `2px solid ${error ? "#E0483E" : "#DADFE0"}`, boxSizing: "border-box", background: "#fff" }}
          />
          {error && <div role="alert" style={{ color: "#E0483E", fontSize: 13, marginTop: 8 }}>{error}</div>}
          <button
            type="submit"
            disabled={!value || checking}
            style={{ width: "100%", marginTop: 14, padding: "14px", fontSize: 15, fontWeight: 700, color: "#fff", background: "#5B46F6", border: "none", borderRadius: 12, cursor: !value || checking ? "default" : "pointer", opacity: !value || checking ? 0.6 : 1 }}
          >
            {checking ? "Checking…" : "Enter"}
          </button>
        </form>
      </div>
    </div>
  );
}
