import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
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
    env: process.env,
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
