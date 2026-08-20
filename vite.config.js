import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Read config.json if it exists
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let config = {};
try {
  const raw = fs.readFileSync(path.join(__dirname, "config.json"), "utf8");
  config = JSON.parse(raw);
} catch {}

const apiPort = process.env.MODEL_DASHBOARD_API_PORT || config.apiPort || 4180;
const frontendPort = process.env.VITE_PORT || config.frontendPort || 4173;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: frontendPort,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
      "/data": `http://127.0.0.1:${apiPort}`,
      "/downloads": `http://127.0.0.1:${apiPort}`,
    },
  },
});
