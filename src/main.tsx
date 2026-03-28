import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Suppress Chrome's automatic PWA install banner
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
});

createRoot(document.getElementById("root")!).render(<App />);
