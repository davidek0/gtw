import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const useShell = process.platform === "win32";
const sharedEnv = {
  ...process.env,
  // The demo's checked-local backend configuration is the single source of
  // truth for every child process. This prevents a stale/empty Windows user
  // variable from making the frontend authenticate with another token than
  // the backend and Garmin monitor.
  ...readEnvFile(path.join(root, "backend", ".env")),
};
const processes = [
  {
    name: "backend",
    command: "npm",
    cwd: path.join(root, "backend"),
    args: ["run", "dev"],
  },
  {
    name: "frontend",
    command: "npm",
    cwd: path.join(root, "frontend"),
    args: ["run", "dev"],
  },
  {
    name: "garmin-live",
    command: "npm",
    cwd: path.join(root, "backend"),
    args: ["run", "garmin:live:monitor"],
  },
  {
    name: "llm-proxy",
    command: "uv",
    cwd: path.join(root, "backend", "conversation"),
    // LiteLLM must remain stateless for this demo, even though the main backend
    // has a DATABASE_URL for Garmin/Drizzle.
    env: { PYTHON_DOTENV_DISABLED: "1" },
    omitEnv: ["DATABASE_URL"],
    args: [
      "run",
      "litellm",
      "--config",
      "litellm/config.yaml",
      "--port",
      "4000",
    ],
  },
  {
    name: "voice",
    command: "uv",
    cwd: path.join(root, "backend", "conversation"),
    args: [
      "run",
      "python",
      "-m",
      "gtw.web_voice",
      "-t",
      "webrtc",
      "--host",
      "0.0.0.0",
      "--port",
      "7860",
    ],
  },
];

let stopping = false;
const children = [];

function startProcess(
  { name, command: executable, cwd, args, env = {}, omitEnv = [] },
  oneShot = false,
) {
  // Node 25 on Windows requires .cmd files to run through a shell. Every
  // command here is a fixed internal npm script, never user-provided input.
  const command = useShell ? [executable, ...args].join(" ") : executable;
  const commandArgs = useShell ? [] : args;
  const processEnv = { ...sharedEnv, ...env };
  for (const name of omitEnv) delete processEnv[name];
  const child = spawn(command, commandArgs, {
    cwd,
    env: processEnv,
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
      else
        console.error(
          `[${name}] failed with code ${code}; the app remains running.`,
        );
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
  "GTW demo running: frontend, backend, browser voice chat, continuous Garmin pulse, and one startup cloud sync.",
);

async function syncGarminAfterBackendStarts() {
  const backendUrl = (sharedEnv.BACKEND_URL || "http://127.0.0.1:3000").replace(
    /\/+$/,
    "",
  );
  for (let attempt = 1; attempt <= 30 && !stopping; attempt += 1) {
    try {
      const response = await fetch(`${backendUrl}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        console.log("Backend ready. Starting one Garmin Cloud sync...");
        startProcess(
          {
            name: "garmin-sync",
            command: "npm",
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
    console.error(
      "Backend did not become ready; startup Garmin sync was skipped.",
    );
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
