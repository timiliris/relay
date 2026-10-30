/// <reference types="vite/client" />

/** Version de l'application, injectée au build depuis package.json (voir vite.config.ts). */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Plateforme cible fournie par le CLI Tauri : `windows`, `darwin`, `linux`… */
  readonly TAURI_ENV_PLATFORM?: string;
  readonly TAURI_ENV_ARCH?: string;
  readonly TAURI_ENV_DEBUG?: string;
}
