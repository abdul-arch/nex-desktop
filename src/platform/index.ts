import type { Platform } from "./contracts";
import { createDesktopPlatform } from "./desktop";
import { createWebPlatform } from "./web";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Adaptateur unique choisi au demarrage. Les composants n'importent jamais Tauri directement. */
export const platform: Platform = isTauri ? createDesktopPlatform() : createWebPlatform();

export * from "./contracts";
