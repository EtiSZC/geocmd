import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

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
