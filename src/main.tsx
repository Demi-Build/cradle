import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles/tokens.css";
import "./styles/start.css";
import App from "./App";

// Dev-only: run the real UI against mock data in a plain browser (no Tauri).
if (import.meta.env.VITE_CRADLE_MOCK) {
  const { installDevMock } = await import("./lib/devMock");
  installDevMock();
  const { useStore } = await import("./store");
  void useStore.getState().loadWorldByPath("mock://plat_pack");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
