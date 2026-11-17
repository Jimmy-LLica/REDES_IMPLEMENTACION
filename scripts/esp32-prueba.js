'use strict';

const { setTimeout: wait } = require('node:timers/promises');
const port = Number(process.env.PORT || 1880);
const flow = Number(process.argv[2] ?? 12);
const pressure = Number(process.argv[3] ?? 1.8);
const soil = [34, 38, 36.5, 41].map((value, index) => {
  const input = process.argv[index + 4];
  return input === 'sin-dato' ? null : Number(input ?? value);
});
const valid = (value, max) => Number.isFinite(value) && value >= 0 && value <= max;

async function main() {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !valid(flow, 12) || !valid(pressure, 1.8)
    || soil.some((value) => value !== null && !valid(value, 100))) {
    throw new Error('Uso: npm run esp32:prueba -- <caudal 0–12> <presión 0–1.8> [S1 S2 S3 S4 en % o sin-dato].');
  }
  const endpoint = `http://127.0.0.1:${port}/riegoguard/esp32`;
  console.log('Cliente de prueba HTTP · ' + endpoint);
  console.log('Selecciona ESP32 externo en Enlace ESP32. Ctrl+C desconecta este cliente.');
  let seq = 0;
  let valve = 0;
  const boot = 'prueba-' + Date.now();
  while (true) {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(2000),
      body: JSON.stringify({ v: 2, farm: 'tacna-centro', boot, seq: ++seq, sampledAt: Date.now(),
        valve, flow, pressure, soil, air: { temperature: 24, humidity: 55 } })
    });
    const line = (await response.text()).trim();
    const command = /^RG2 ([0-4]) (\d+) (\d+)$/.exec(line);
    if (!response.ok || !command) throw new Error('Respuesta no reconocida del flujo (HTTP ' + response.status + ').');
    valve = Number(command[1]);
    console.log(`Paquete ${seq} · Trama ${command[2]} · ${valve ? 'S' + valve + ' abierta' : 'Todas cerradas'}`);
    await wait(700);
  }
}

main().catch((error) => {
  console.error(error.message + ' Comprueba que Node-RED esté activo en el mismo puerto.');
  process.exitCode = 1;
});
