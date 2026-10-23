import { spawn } from 'node:child_process';
if (process.env.APP_ROLE === 'web') {
  const { startWeb } = await import('./web-server.mjs');
  startWeb();
} else {
  const child = spawn('npm', ['run', 'start'], { stdio: 'inherit', shell: process.platform === 'win32' });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', () => process.exit(1));
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
