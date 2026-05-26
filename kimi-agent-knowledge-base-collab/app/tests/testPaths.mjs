import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));

export const appRoot = path.resolve(testsDir, "..");

export function resolveAppPath(...segments) {
  return path.join(appRoot, ...segments);
}

export function importAppModule(...segments) {
  return import(pathToFileURL(resolveAppPath(...segments)).href);
}

export function runTypeScriptCheck(configRelativePath) {
  const tscBinary = process.platform === "win32"
    ? resolveAppPath("node_modules", ".bin", "tsc.cmd")
    : resolveAppPath("node_modules", ".bin", "tsc");

  execFileSync(tscBinary, [
    "-p",
    resolveAppPath(configRelativePath),
    "--pretty",
    "false",
  ], {
    cwd: appRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
}
