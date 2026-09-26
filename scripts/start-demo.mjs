import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
// The voice check-in services read their own configuration (LLM broker keys).
const conversationEnv = readEnvFile(
  path.join(root, "backend", "conversation", ".env"),
);
const processes = [
  {
    name: "backend",
    command: "npm",
    cwd: path.join(root, "backend"),
    args: ["run", "dev"],
    requires: ["DATABASE_URL"],
    optional: true,
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
    requires: ["DATABASE_URL", "ADMIN_API_TOKEN"],
    optional: true,
  },
  {
    name: "llm-proxy",
    command: "uv",
    cwd: path.join(root, "backend", "conversation"),
    // LiteLLM must remain stateless for this demo, even though the main backend
    // has a DATABASE_URL for Garmin/Drizzle.
    env: { ...conversationEnv, PYTHON_DOTENV_DISABLED: "1" },
    omitEnv: ["DATABASE_URL", "DIRECT_URL"],
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
    env: conversationEnv,
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
  {
    name,
    command: executable,
    cwd,
    args,
    env = {},
    omitEnv = [],
    optional = false,
  },
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
    // Its own process group, so shutdown also reaches the servers npm/uv start.
    detached: !useShell,
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
    } else if (optional) {
      console.error(
        `[${name}] stopped with code ${code}; the rest of the demo keeps running.`,
      );
    } else {
      console.error(`[${name}] stopped unexpectedly with code ${code}.`);
      shutdown(code || 1);
    }
  });
  children.push(child);
  return child;
}

installMissingDependencies();
const started = new Set();
for (const processDefinition of processes) {
  const { name, env = {}, requires = [] } = processDefinition;
  const missing = requires.filter(
    (key) => !(env[key] ?? sharedEnv[key])?.trim(),
  );
  if (missing.length) {
    console.warn(
      `[${name}] skipped: set ${missing.join(", ")} in backend/.env to enable it.`,
    );
    continue;
  }
  startProcess(processDefinition);
  started.add(name);
}
if (started.has("backend")) void syncGarminAfterBackendStarts();

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) stopTree(child);
  setTimeout(() => process.exit(code), 1_000).unref();
}

function stopTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (useShell) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    return;
  }
  try {
    process.kill(-child.pid, "SIGINT");
  } catch {
    // The group has already exited.
  }
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

console.log(`GTW demo running: ${[...started].join(", ")}.`);

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

function installMissingDependencies() {
  for (const dir of ["backend", "frontend"]) {
    const cwd = path.join(root, dir);
    if (existsSync(path.join(cwd, "node_modules"))) continue;
    console.log(`Installing ${dir} dependencies...`);
    // The frontend is locked with bun.lock; don't leave a second lockfile behind.
    const args =
      dir === "frontend" ? ["install", "--no-package-lock"] : ["install"];
    const result = spawnSync(
      useShell ? `npm ${args.join(" ")}` : "npm",
      useShell ? [] : args,
      {
        cwd,
        stdio: "inherit",
        shell: useShell,
      },
    );
    if (result.status !== 0) {
      console.error(`npm install failed in ${dir}.`);
      process.exit(1);
    }
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
