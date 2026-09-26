import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
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
const children = processes.map(({ name, cwd, args }) => {
  const child = spawn(npm, args, {
    cwd,
    env: sharedEnv,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
  });
  child.on("exit", (code) => {
    if (!stopping && code !== 0) {
      console.error(`[${name}] stopped unexpectedly with code ${code}.`);
      shutdown(1);
    }
  });
  return child;
});

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGINT");
  setTimeout(() => process.exit(code), 1_000).unref();
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

console.log("GTW demo running: frontend, backend, and continuous Garmin pulse monitor.");

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
