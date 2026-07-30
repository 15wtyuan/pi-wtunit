import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(extensionDir, "..");
const assetsDir = resolve(packageRoot, "assets");
const piAgentDir = resolve(homedir(), ".pi", "agent");

const MARKER_FILE = resolve(piAgentDir, ".pi-wtunit-setup-done");

const filesToSync = ["keybindings.json", "zentui.json"];

let setupDone = false;

export default function setupPiWtunit(_pi: ExtensionAPI) {
  _pi.on("session_start", async () => {
    if (setupDone) return;
    if (existsSync(MARKER_FILE)) {
      setupDone = true;
      return;
    }

    try {
      for (const filename of filesToSync) {
        const dest = resolve(piAgentDir, filename);
        if (!existsSync(dest)) {
          const src = resolve(assetsDir, filename);
          if (existsSync(src)) {
            mkdirSync(piAgentDir, { recursive: true });
            copyFileSync(src, dest);
          }
        }
      }
      // Write marker to skip future runs
      writeFileSync(MARKER_FILE, `setup: ${new Date().toISOString()}\n`, "utf-8");
    } catch {
      // Silently fail — user can manually copy configs
    }

    setupDone = true;
  });
}
