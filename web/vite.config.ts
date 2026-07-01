import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function getApiProxy(baseUrl: string) {
  const url = new URL(baseUrl || "http://localhost:8080");
  const basePath = url.pathname.replace(/\/$/, "");

  return {
    target: url.origin,
    changeOrigin: true,
    ws: true,
    rewrite: (path: string) => {
      const nextPath = path.replace(/^\/api/, "");
      return `${basePath}${nextPath || "/"}`;
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      port: 5173,

      watch: {
        ignored: ["**/src-tauri/target/**"],
      },

      proxy: {
        "/api": getApiProxy(env.VITE_API_BASE_URL),
      },
    },
  };
});
