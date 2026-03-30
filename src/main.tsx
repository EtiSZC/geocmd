import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

// Register Service Worker for background push notifications
const isInIframe = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();
const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com");

if (!isPreviewHost && !isInIframe) {
  registerSW({ immediate: true });
}

// Capture PWA install prompt for manual trigger
let deferredPrompt: any = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  window.dispatchEvent(new Event("pwa-install-available"));
});
window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  window.dispatchEvent(new Event("pwa-install-done"));
});
(window as any).__getPWAInstallPrompt = () => deferredPrompt;

createRoot(document.getElementById("root")!).render(<App />);
