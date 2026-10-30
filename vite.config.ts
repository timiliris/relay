/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Variables injectées par le CLI Tauri (`tauri dev` / `tauri build`).
const host = process.env.TAURI_DEV_HOST;
const isDebug = Boolean(process.env.TAURI_ENV_DEBUG);
const targetPlatform = process.env.TAURI_ENV_PLATFORM;

// Version unique : src-tauri/tauri.conf.json est la source de vérité (bundles, package_info, UI).
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./src-tauri/tauri.conf.json', import.meta.url)), 'utf8'),
) as { version: string };

export default defineConfig({
  plugins: [
    // React Compiler via Oxc (sans Babel) : memoïsation automatique des composants.
    react({ compiler: true }),
    tailwindcss(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri attend un port fixe : échouer si indisponible plutôt que d'en choisir un autre.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      // Les sources Rust sont surveillées par le CLI Tauri, pas par Vite.
      ignored: ['**/src-tauri/**'],
    },
  },
  // Expose les variables TAURI_ENV_* au frontend (import.meta.env).
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // WebView2 (Windows) est basé sur Chromium ; WKWebView (macOS) et WebKitGTK (Linux) sur Safari.
    target: targetPlatform === 'windows' ? 'chrome105' : 'safari13',
    minify: !isDebug,
    sourcemap: isDebug,
    // react-markdown + highlight.js : un seul bundle local, pas de réseau, la taille importe peu.
    chunkSizeWarningLimit: 1000,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
