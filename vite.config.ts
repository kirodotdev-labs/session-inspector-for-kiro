import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri's devUrl (src-tauri/tauri.conf.json) is hardcoded to
  // http://localhost:5173 — if that port is taken, Vite would normally fall
  // back to another port (5174, ...) while the Tauri webview keeps loading
  // 5173 unaware, silently rendering whatever else is on that port. Failing
  // fast here surfaces the conflict instead.
  server: {
    port: 5173,
    strictPort: true,
  },
});
