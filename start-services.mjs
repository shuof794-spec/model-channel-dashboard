import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.MODEL_DASHBOARD_PYTHON = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
process.env.RELAYWATCH_PYTHON = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
process.env.BANANA_HTTP_PROXY = 'http://127.0.0.1:17890';

console.log('Starting API server...');
const api = spawn('node', ['server.mjs'], { cwd: __dirname, stdio: 'inherit', detached: true });
api.unref();

setTimeout(() => {
  console.log('Starting Vite...');
  const vite = spawn('npx', ['vite', '--host', '127.0.0.1'], { cwd: __dirname, stdio: 'inherit', detached: true });
  vite.unref();
}, 2000);
