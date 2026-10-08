// The end-of-rest chime. Real ask: rest-timer alerts.
//
// Scheduled in ADVANCE with Web Audio at the moment a set is checked off: that
// tap is the user gesture browsers require before they'll play any sound, and
// a sound scheduled on the audio clock fires on time even while the page's own
// timers are being throttled (screen dimmed, phone in a pocket). It cannot
// fire once the app is closed — that needs server push notifications.
//
// Kept in its own module so tests can replace it; jsdom has no audio at all,
// and everything here quietly does nothing where audio isn't available.
const MUTE_KEY = "overload_rest_chime_muted";
let ctx = null;
let pending = [];

export function isRestChimeMuted() {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch (e) { return false; }
}

export function setRestChimeMuted(muted) {
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) {}
  if (muted) cancelRestChime();
}

export function cancelRestChime() {
  pending.forEach((osc) => { try { osc.stop(); } catch (e) {} });
  pending = [];
}

export function scheduleRestChime(secondsFromNow) {
  cancelRestChime();
  if (isRestChimeMuted()) return;
  try {
    const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") ctx.resume();
    const at = ctx.currentTime + Math.max(0, Number(secondsFromNow) || 0);
    // Two short rising notes — noticeable over gym music, not alarming.
    [[0, 880], [0.18, 1175]].forEach(([offset, freq]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at + offset);
      gain.gain.exponentialRampToValueAtTime(0.3, at + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + offset + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at + offset);
      osc.stop(at + offset + 0.32);
      pending.push(osc);
    });
  } catch (e) {
    // Audio is a nicety; never let it break the workout screen.
  }
}

// A buzz as well, where the phone supports it (Android; iPhones don't let
// websites vibrate). Called when the countdown actually reaches zero.
export function buzzRestDone() {
  try { if (!isRestChimeMuted() && typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([180, 90, 180]); } catch (e) {}
}
