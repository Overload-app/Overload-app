import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";

// Registers the service worker that precaches the app shell so it can open
// with no signal (e.g. mid-workout at the gym), and auto-updates it in the
// background whenever a new version is deployed.
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
