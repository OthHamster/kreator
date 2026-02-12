const { execSync } = require("child_process");

function killPort(port) {
  const portNumber = Number(port);
  if (!Number.isInteger(portNumber) || portNumber <= 0) {
    throw new Error(`Invalid port: ${port}`);
  }

  if (process.platform === "win32") {
    let output = "";
    try {
      output = execSync(`netstat -ano -p tcp | findstr :${portNumber}`, {
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
      });
    } catch {
      return;
    }

    const pids = new Set();
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) pids.add(pid);
    }

    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      } catch {
        // ignore
      }
    }
    return;
  }

  try {
    const pids = execSync(`lsof -ti tcp:${portNumber}`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    })
      .split(/\s+/)
      .filter(Boolean);

    for (const pid of pids) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

try {
  killPort(process.argv[2]);
} catch (error) {
  console.error(error?.message || String(error));
  process.exit(1);
}
