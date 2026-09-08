import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};
run('python3', ['-m', 'unittest', '-v', 'tests/test_inventory_guards.py']);
const tests = readdirSync('tests').filter(name => /^test_.*\.mjs$/.test(name)).sort().map(name => `tests/${name}`);
run(process.execPath, ['--experimental-vm-modules', '--test', ...tests]);
