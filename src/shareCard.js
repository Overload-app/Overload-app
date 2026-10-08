// Shareable workout card. Real ask (launch prep): every share to an Instagram
// or TikTok story is free advertising. Draws a 1080x1920 story-sized image of
// a finished workout and hands it to the phone's own share sheet — or, where
// a browser can't share files, downloads it instead.
//
// Pure canvas, no libraries. The numbers come from workoutSummary() in
// App.jsx; this file only draws and shares them.

const W = 1080;
const H = 1920;
const INK = "#0D0E15";
const CHARGE = "#5B46F6";
const SOFT = "#B9BEC6";
const GOOD = "#1F9E6E";

function formatDuration(sec) {
  if (!sec || sec < 60) return "<1 min";
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Long names shrink to fit rather than running off the card.
function fitText(ctx, text, maxWidth, size, weight, family) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && s > 24) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

// The app icon, drawn rather than loaded: two plates either side of a bar.
function drawLogo(ctx, x, y, size) {
  const u = size / 16;
  ctx.fillStyle = CHARGE;
  ctx.fillRect(x + 2 * u, y + 7 * u, 12 * u, 2 * u);
  ctx.fillStyle = "#FFFFFF";
  [[0, 4], [3, 4], [10, 4], [13, 4]].forEach(([px]) => ctx.fillRect(x + px * u, y + 4 * u, 2.2 * u, 8 * u));
}

export function drawShareCard(canvas, summary) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const display = "'Space Grotesk', 'Inter', system-ui, sans-serif";
  const mono = "'JetBrains Mono', ui-monospace, monospace";

  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  // A soft violet glow behind the headline.
  const glow = ctx.createRadialGradient(W * 0.8, 260, 40, W * 0.8, 260, 760);
  glow.addColorStop(0, "rgba(91,70,246,0.45)");
  glow.addColorStop(1, "rgba(91,70,246,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const left = 96;
  let y = 220;
  ctx.fillStyle = CHARGE;
  ctx.font = `700 34px ${mono}`;
  ctx.fillText("WORKOUT COMPLETE", left, y);

  y += 120;
  ctx.fillStyle = "#FFFFFF";
  fitText(ctx, summary.dayName, W - left * 2, 104, 700, display);
  ctx.fillText(summary.dayName, left, y);

  y += 70;
  ctx.fillStyle = SOFT;
  ctx.font = `500 38px ${display}`;
  ctx.fillText(summary.dateLabel, left, y);

  // Three big stats.
  y += 150;
  const stats = [
    ["TIME", formatDuration(summary.durationSec)],
    ["SETS", String(summary.setsDone)],
    ["VOLUME", summary.volume > 0 ? `${summary.volume.toLocaleString()} lb` : "—"],
  ];
  const col = (W - left * 2) / 3;
  stats.forEach(([label, value], i) => {
    const x = left + i * col;
    ctx.fillStyle = SOFT;
    ctx.font = `700 28px ${mono}`;
    ctx.fillText(label, x, y);
    ctx.fillStyle = "#FFFFFF";
    fitText(ctx, value, col - 24, 64, 700, display);
    ctx.fillText(value, x, y + 80);
  });

  y += 200;
  if (summary.prs.length > 0) {
    ctx.fillStyle = GOOD;
    ctx.font = `700 30px ${mono}`;
    ctx.fillText(summary.prs.length === 1 ? "NEW PR" : `${summary.prs.length} NEW PRS`, left, y);
    y += 30;
    summary.prs.slice(0, 3).forEach((pr) => {
      y += 78;
      ctx.fillStyle = "#FFFFFF";
      const line = `${pr.name} — ${pr.weight} lb × ${pr.reps}`;
      fitText(ctx, line, W - left * 2, 46, 600, display);
      ctx.fillText(line, left, y);
    });
    y += 90;
  }

  // What they did, best set per exercise.
  ctx.fillStyle = SOFT;
  ctx.font = `700 30px ${mono}`;
  ctx.fillText("EXERCISES", left, y);
  y += 20;
  const rows = summary.exercises.slice(0, 7);
  rows.forEach((e) => {
    y += 72;
    ctx.fillStyle = "#FFFFFF";
    const best = e.weight > 0 ? `${e.weight} × ${e.reps}` : e.setsDone > 0 ? `${e.setsDone} sets` : "";
    fitText(ctx, e.name, W - left * 2 - 260, 42, 500, display);
    ctx.fillText(e.name, left, y);
    ctx.fillStyle = SOFT;
    ctx.font = `600 38px ${mono}`;
    const bw = ctx.measureText(best).width;
    ctx.fillText(best, W - left - bw, y);
  });
  if (summary.exercises.length > rows.length) {
    y += 64;
    ctx.fillStyle = SOFT;
    ctx.font = `500 34px ${display}`;
    ctx.fillText(`+ ${summary.exercises.length - rows.length} more`, left, y);
  }

  // Footer.
  drawLogo(ctx, left, H - 230, 96);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 52px ${display}`;
  ctx.fillText("OVERLOAD", left + 120, H - 160);
  ctx.fillStyle = SOFT;
  ctx.font = `500 32px ${display}`;
  ctx.fillText("overload-app.com", left + 120, H - 112);
  return canvas;
}

export function renderShareCard(summary) {
  return new Promise((resolve, reject) => {
    try {
      const canvas = drawShareCard(document.createElement("canvas"), summary);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't create the image"))), "image/png");
    } catch (e) {
      reject(e);
    }
  });
}

// The phone's own share sheet (straight into Instagram/TikTok stories,
// Messages...) where the browser can share files; otherwise a download.
// Returns "shared", "downloaded" or "cancelled".
export async function shareOrDownload(blob, filename) {
  const file = typeof File !== "undefined" ? new File([blob], filename, { type: "image/png" }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (e) {
      if (e && e.name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "downloaded";
}
