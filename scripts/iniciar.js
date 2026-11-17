'use strict';

const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.join(__dirname, '..');
const port = Number(process.env.PORT || 1880);
const base = `http://127.0.0.1:${port}`;
const panel = base + '/riegoguard/panel?view=parcel3d';
const version = 5;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function health() {
  try {
    const response = await fetch(base + '/riegoguard/estado', { signal: AbortSignal.timeout(1300) });
    const data = response.ok ? await response.json() : null;
    return data?.project === 'RiegoGuard-Tacna' ? data : null;
  } catch {
    return false;
  }
}

function occupied() {
  return new Promise((resolve) => {
    const client = net.createConnection({ port, host: '127.0.0.1' });
    client.setTimeout(600);
    client.once('connect', () => { client.destroy(); resolve(true); });
    client.once('timeout', () => { client.destroy(); resolve(false); });
    client.once('error', () => resolve(false));
  });
}

function showLinks() {
  console.log('\nFlujo activo. Node-RED ya está actualizando el reloj y las lecturas.');
  console.log('Panel 2D/3D   ' + panel);
  console.log('Editor        ' + base + '/');
  console.log('Estado JSON   ' + base + '/riegoguard/estado');
  console.log('ESP32/Wokwi   POST http://host.wokwi.internal:' + port + '/riegoguard/esp32\n');
  if (process.argv.includes('--abrir') && process.platform === 'win32') {
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', panel], {
      stdio: 'ignore', windowsHide: true, detached: true
    });
    browser.once('error', () => console.log('Abre la dirección del panel en tu navegador.'));
    browser.unref();
  }
}

async function main() {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('PORT debe ser un número entre 1024 y 65535.');
  }
  if (await occupied()) {
    const existing = await health();
    if (existing?.version === version && existing.state.transport.ticks > 0) {
      console.log('RiegoGuard ya está abierto en este puerto.');
      showLinks();
      return;
    }
    if (existing && existing.version !== version) {
      throw new Error(`RiegoGuard v${existing.version} sigue abierto en el puerto ${port}. Cierra la consola anterior y vuelve a ejecutar este iniciador.`);
    }
    throw new Error(`El puerto ${port} está ocupado por otro servicio o por el flujo anterior. Cierra esa instancia o ejecuta con otro PORT y usa el mismo puerto en Wokwi.`);
  }
  const server = spawn(process.execPath, [
    require.resolve('node-red/red.js'), '--userDir', root, '--settings', path.join(root, 'settings.js'),
    '--port', String(port), 'flows.json'
  ], { cwd: root, stdio: 'inherit', windowsHide: true });
  const stop = () => { if (server.exitCode === null) server.kill(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  server.once('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.once('exit', (code) => { process.exitCode = code || 0; });
  const deadline = Date.now() + 120000;
  while (server.exitCode === null && !server.killed && Date.now() < deadline) {
    const current = await health();
    if (current?.version === version && current.state.transport.ticks > 0) {
      showLinks();
      return;
    }
    await pause(500);
  }
  if (server.exitCode === null && !server.killed) {
    stop();
    throw new Error('Node-RED no respondió con el flujo activo. Revisa los mensajes de inicio.');
  }
}

main().catch((error) => {
  console.error('\n' + error.message);
  process.exitCode = 1;
});
