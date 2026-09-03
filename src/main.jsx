import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App, { ErrorBoundary } from "./App.jsx";

// Registers the service worker that precaches the app shell so it can open
// with no signal (e.g. mid-workout at the gym), and auto-updates it in the
// background whenever a new version is deployed.
registerSW({
  immediate: true,
  onRegisteredSW(swUrl, registration) {
    if (!registration) return;
    // A phone installed as a home-screen app can otherwise sit on an old
    // cached version indefinitely — actively check for a newer deploy
    // whenever the app is reopened/foregrounded, not just on cold start.
    const checkForUpdate = () => registration.update();
    setInterval(checkForUpdate, 60 * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate();
    });
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
