import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

/**
 * Tauri development requires a fixed Vite port. Strict port selection prevents Vite from switching
 * ports while the native shell still requests the old address and displays a blank page.
 *
 * Tauri 在开发模式下依赖固定端口连接 Vite。严格端口可以避免 Vite
 * 自动换端口后，原生壳仍然访问旧地址而显示空白页面。
 */
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const webRuntime = mode === "web";
  const extensionRuntime = mode === "extension";
  const tauriRuntime = mode === "tauri";
  const pwaBase = normalizeBase(environment.VITE_PWA_BASE || "/swipy/");
  const base = webRuntime ? pwaBase : "/";
  const proxyTarget = environment.VITE_FRESHRSS_DEV_TARGET?.trim();
  const apiProxy = proxyTarget ? {
    "/api/greader.php": {
      target: proxyTarget,
      changeOrigin: true,
      secure: true,
    },
  } : undefined;

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      ...(webRuntime ? [VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["apple-touch-icon.png"],
        manifest: {
          id: base,
          name: "SwipyRSS",
          short_name: "SwipyRSS",
          description: "专注、连续的 FreshRSS 阅读客户端",
          lang: "zh-CN",
          start_url: base,
          scope: base,
          display: "standalone",
          background_color: "#eef2f6",
          theme_color: "#eef2f6",
          icons: [
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "pwa-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2}"],
          globIgnores: ["apple-touch-icon.png", "pwa-*.png", "pwa-maskable.svg"],
        },
        devOptions: { enabled: false },
      })] : []),
    ],
    resolve: {
      alias: {
        "@platform/styles.css": fileURLToPath(new URL(
          tauriRuntime ? "./platforms/tauri/styles.css" : "./src/styles/index.css",
          import.meta.url,
        )),
        "@platform": fileURLToPath(new URL(
          tauriRuntime ? "./platforms/tauri/index.ts" : "./src/platform/web.ts",
          import.meta.url,
        )),
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    clearScreen: false,
    server: {
      allowedHosts: ["terminal.local"],
      host: "127.0.0.1",
      port: 1420,
      strictPort: true,
      proxy: apiProxy,
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
      proxy: apiProxy,
    },
    envPrefix: ["VITE_", "TAURI_"],
    build: {
      target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
      minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
      sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
      ...(extensionRuntime ? {
        outDir: "dist-extension",
        manifest: true,
        cssCodeSplit: false,
        rollupOptions: {
          output: {
            inlineDynamicImports: true,
          },
        },
      } : {}),
    },
  };
});

function normalizeBase(value: string): string {
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}
