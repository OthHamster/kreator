const { spawn } = require("child_process");

const concurrentlyBin = require.resolve("concurrently/dist/bin/concurrently.js");
const args = [
  concurrentlyBin,
  "-n",
  "backend,frontend",
  "-c",
  "blue,green",
  "npm --prefix backend run dev",
  "npm --prefix frontend run dev",
];

const child = spawn(process.execPath, args, {
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
