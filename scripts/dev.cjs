const { spawn } = require("child_process");

const children = [];
let shuttingDown = false;

function startProcess(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  child.on("error", (error) => {
    console.error(`[${name}] failed to start`, error);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (code === 0) {
      console.log(`[${name}] exited`);
      shutdown(0);
      return;
    }

    const reason = signal
      ? `[${name}] terminated by signal ${signal}`
      : `[${name}] exited with code ${code}`;
    console.error(reason);
    shutdown(typeof code === "number" ? code : 1);
  });

  children.push(child);
  return child;
}

function stopChild(child) {
  if (!child || child.killed) {
    return;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      shell: true,
    });
    return;
  }

  child.kill("SIGTERM");
}

function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    stopChild(child);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 100);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("[dev] starting backend and frontend...");
startProcess("backend", "npm", ["--prefix", "backend", "run", "dev"]);
startProcess("frontend", "npm", ["--prefix", "frontend", "run", "dev"]);
