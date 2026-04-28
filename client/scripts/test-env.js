import { spawn } from 'child_process';
import treeKill from 'tree-kill';
import { fileURLToPath } from 'url';

const activeProcesses = new Set();
let isTearingDown = false;

/**
 * Spawns a background development process and logs its output with a prefix.
 * @param {string} name - The prefix for the logs (e.g. '[VITE]')
 * @param {string} command - The CLI command base (e.g. 'npm')
 * @param {string[]} args - The arguments for the command
 * @param {string} cwd - The working directory for the spawn
 * @returns {import('child_process').ChildProcess}
 */
export function spawnProcess(name, command, args, cwd) {
  // Use shell on Windows to reliably run npm/npx commands
  const useShell = process.platform === 'win32';
  
  const child = spawn(command, args, {
    cwd,
    shell: useShell,
    stdio: 'pipe',
  });

  const prefix = `\x1b[1m\x1b[36m${name}\x1b[0m`;

  child.stdout.on('data', (data) => {
    const lines = data.toString().trimEnd().split('\n');
    lines.forEach(line => process.stdout.write(`${prefix} ${line}\n`));
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trimEnd().split('\n');
    lines.forEach(line => process.stderr.write(`${prefix} \x1b[31m${line}\x1b[0m\n`));
  });

  child.on('close', (code) => {
    if (!isTearingDown) {
      console.log(`\x1b[33m${name} process exited with code ${code}\x1b[0m`);
    }
    activeProcesses.delete(child);
  });

  child.on('error', (err) => {
    console.error(`${prefix} \x1b[31mError: ${err.message}\x1b[0m`);
  });

  activeProcesses.add(child);
  return child;
}

/**
 * Tears down all tracked processes.
 * @returns {Promise<void>}
 */
export async function teardown() {
  if (isTearingDown) return;
  isTearingDown = true;
  console.log('\n\x1b[33mShutting down all processes gracefully...\x1b[0m');

  const killPromises = Array.from(activeProcesses).map((child) => {
    return new Promise((resolve) => {
      if (child.pid) {
        treeKill(child.pid, 'SIGKILL', (err) => {
          if (err) console.error(`Error killing process ${child.pid}:`, err);
          resolve();
        });
      } else {
        resolve();
      }
    });
  });

  await Promise.all(killPromises);
  activeProcesses.clear();
  console.log('\x1b[32mAll test servers have been terminated safely. Goodbye!\x1b[0m');
  process.exit(0);
}

/**
 * Bootstraps both Vite and the mock backend API.
 */
export function bootstrap() {
  console.log('\x1b[1m\x1b[32mStarting Harmony Test Environment...\x1b[0m\n');

  // Launch mock API server
  spawnProcess(
    '[SERVER]',
    'npm',
    ['run', 'start', '--prefix', '../server', '--', '--mock', '--port', '3001'],
    process.cwd()
  );

  // Launch Vite client
  spawnProcess(
    '[VITE]',
    'npm',
    ['run', 'dev'],
    process.cwd()
  );

  // Cross-platform SIGINT/SIGTERM handling
  process.on('SIGINT', teardown);
  process.on('SIGTERM', teardown);
}

// Ensure execution only when orchestrated via CLI (e.g. node test-env.js)
const isMainModule = typeof process !== 'undefined' && process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  bootstrap();
}
