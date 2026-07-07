import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { SettingsProvider } from "./lib/settings";
import { AnalysisProvider } from "./lib/analysis";
import { UpdaterProvider } from "./lib/updater";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <AnalysisProvider>
        <UpdaterProvider>
          <App />
        </UpdaterProvider>
      </AnalysisProvider>
    </SettingsProvider>
  </StrictMode>
);
