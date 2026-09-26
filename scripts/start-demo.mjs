import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = "npm";
const useShell = process.platform === "win32";
const sharedEnv = {
  ...readEnvFile(path.join(root, "backend", ".env")),
  ...process.env,
};
const processes = [
  { name: "backend", cwd: path.join(root, "backend"), args: ["run", "dev"] },
  { name: "frontend", cwd: path.join(root, "frontend"), args: ["run", "dev"] },
  {
    name: "garmin-live",
    cwd: path.join(root, "backend"),
    args: ["run", "garmin:live:monitor"],
  },
];

let stopping = false;
const children = [];

function startProcess({ name, cwd, args }, oneShot = false) {
  // Node 25 on Windows requires .cmd files to run through a shell. Every
  // command here is a fixed internal npm script, never user-provided input.
  const command = useShell ? [npm, ...args].join(" ") : npm;
  const commandArgs = useShell ? [] : args;
  const child = spawn(command, commandArgs, {
    cwd,
    env: sharedEnv,
    stdio: "inherit",
    shell: useShell,
  });

  child.on("error", (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
    if (!oneShot) shutdown(1);
  });
  child.on("exit", (code) => {
    if (stopping) return;
    if (oneShot) {
      if (code === 0) console.log(`[${name}] completed.`);
      else console.error(`[${name}] failed with code ${code}; the app remains running.`);
    } else {
      console.error(`[${name}] stopped unexpectedly with code ${code}.`);
      shutdown(code || 1);
    }
  });
  children.push(child);
  return child;
}

for (const processDefinition of processes) startProcess(processDefinition);
void syncGarminAfterBackendStarts();

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGINT");
  setTimeout(() => process.exit(code), 1_000).unref();
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

console.log(
  "GTW demo running: frontend, backend, continuous Garmin pulse, and one startup cloud sync.",
);

async function syncGarminAfterBackendStarts() {
  const backendUrl = (sharedEnv.BACKEND_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
  for (let attempt = 1; attempt <= 30 && !stopping; attempt += 1) {
    try {
      const response = await fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        console.log("Backend ready. Starting one Garmin Cloud sync...");
        startProcess(
          {
            name: "garmin-sync",
            cwd: path.join(root, "backend"),
            args: ["run", "garmin:sync"],
          },
          true,
        );
        return;
      }
    } catch {
      // Backend is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!stopping) {
    console.error("Backend did not become ready; startup Garmin sync was skipped.");
  }
}

function readEnvFile(file) {
  try {
    return Object.fromEntries(
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const separator = line.indexOf("=");
          const key = line.slice(0, separator).trim();
          let value = line.slice(separator + 1).trim();
          if (
            value.length >= 2 &&
            ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'")))
          ) {
            value = value.slice(1, -1);
          }
          return [key, value];
        }),
    );
  } catch {
    return {};
  }
}
