import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { SettingsProvider } from "./lib/settings";
import { AnalysisProvider } from "./lib/analysis";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <AnalysisProvider>
        <App />
      </AnalysisProvider>
    </SettingsProvider>
  </StrictMode>
);
