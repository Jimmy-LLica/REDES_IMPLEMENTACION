// Cuerpo del nodo function «Control de riego» generado en flows.json.
const model = context.get('modelo');
const telemetry = context.get('telemetria');
const central = context.get('central');
let state = context.get('estado');
const bus = context.get('bus');
const now = Date.now();

function unpack(data) {
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch { return data; }
  }
  if (typeof data === 'object' && data !== null) {
    if (typeof data.data === 'string') {
      try { return JSON.parse(data.data); } catch {}
    }
    if (typeof data.payload === 'string') {
      try { return JSON.parse(data.payload); } catch {}
    }
    const keys = Object.keys(data);
    if (keys.length === 1 && typeof keys[0] === 'string' && keys[0].startsWith('{')) {
      try { return JSON.parse(keys[0]); } catch {}
    }
  }
  return data;
}

msg.payload = unpack(msg.payload);
const command = msg.topic === 'orden-http';
let topic = msg.topic;
let value = msg.payload;
let error;

function httpReply(statusCode, payload, type = 'application/json; charset=utf-8') {
  return { req: msg.req, res: msg.res, statusCode, headers: { 'Content-Type': type }, payload };
}

if (command) {
  const valid = {
    start: () => true, next: () => true, stop: () => true, reset: () => true,
    mode: (item) => Object.hasOwn(model.MODES, item),
    fault: (item) => Object.hasOwn(model.FAULTS, item),
    online: (item) => typeof item === 'boolean',
    source: (item) => item === 'local' || item === 'wokwi'
  };
  topic = msg.payload?.topic;
  value = msg.payload?.value;
  if (typeof topic !== 'string' || !Object.hasOwn(valid, topic) || !valid[topic](value)) {
    return [null, httpReply(400, { error: 'Orden inválida' }), null];
  }
}

if (topic === 'central-http') {
  return [null, httpReply(200, { updatedAt: now, areas: telemetry.summary(central, now), packetTracer: bus.packetTracer ?? null }), null];
}

if (topic === 'red-status-http') {
  if (typeof msg.payload === 'string') {
    try { msg.payload = JSON.parse(msg.payload); } catch {}
  }
  console.log('DIAGNOSTICO RECIBIDO EN NODE-RED:', JSON.stringify(msg.payload));
  let { norte, sur, postNorte, postSur, virtualNorte = 0, virtualSur = 0 } = msg.payload || {};
  postNorte = Number(postNorte) || 0;
  postSur = Number(postSur) || 0;
  virtualNorte = Number(virtualNorte) || 0;
  virtualSur = Number(virtualSur) || 0;
  const stages = ['esperando', 'alcanzable', 'sin-respuesta', 'respuesta-invalida'];
  if (!stages.includes(norte)) norte = 'esperando';
  if (!stages.includes(sur)) sur = 'esperando';
  bus.packetTracer = { at: now, norte, sur, postNorte, postSur, virtualNorte, virtualSur };
  return [null, httpReply(200, { ok: true }), null];
}

if (topic === 'esp32' || topic === 'red-http') {
  console.log('TELEMETRIA RECIBIDA:', topic, JSON.stringify(msg.payload));
  if (typeof msg.payload === 'string') {
    try { msg.payload = JSON.parse(msg.payload); } catch {}
  }
  const source = topic === 'esp32' ? 'wokwi' : 'packet-tracer';
  const result = telemetry.accept(central, msg.payload, source, now, model.CONFIG);
  if (result.error) return [null, httpReply(result.status, { error: result.error, version: 2 }), null];
  if (result.sync) {
    return [null, httpReply(200, 'RG2 0 ' + bus.frame + ' ' + now + '\n', 'text/plain; charset=utf-8'), null];
  }
  try {
    context.set('central', central, 'historico');
  } catch {
    // En una instalación importada sin el almacén opcional, central sigue en memoria.
  }
  if (source === 'packet-tracer') {
    return [null, httpReply(200, { ok: true, farm: msg.payload.farm, packets: result.entry.packets }), {
      topic: 'packet-tracer', payload: { parcela: msg.payload.farm, secuencia: result.packet.seq, paquetes: result.entry.packets }
    }];
  }
  bus.packet = result.packet;
  bus.packets = result.entry.packets;
}

const available = telemetry.available(bus.packet, 'tacna-centro', now);
const connectionChanged = available !== bus.connected;
if (bus.source === 'wokwi' && !available && bus.connected) {
  model.dispatch(state, 'source-lost');
}
bus.connected = available;

if (topic === 'source') {
  const next = value;
  if (!error && (next === 'local' || next === 'wokwi') && next !== bus.source) {
    bus.source = next;
    model.dispatch(state, 'source', next === 'wokwi' ? 'ESP32 externo (Wokwi).' : 'Simulador interno.');
  }
}
const external = bus.source === 'wokwi';
model.setSupply(state, external, available ? bus.packet : null);

if (topic === 'tick') {
  bus.ticks++;
}
if (!error && (topic === 'start' || topic === 'next') && external && !available) {
  error = 'Se perdió la comunicación con el ESP32. Comprueba el enlace o elige Simulador interno.';
}
if (!error && command && (topic === 'start' || topic === 'next') && !model.canRearm(state)) {
  error = 'Restablece la condición Normal y verifica que el caudal y la presión se recuperaron antes de rearmar.';
}
if (['start', 'next', 'stop', 'reset', 'mode', 'fault', 'online', 'source'].includes(topic)) {
  bus.actions++;
  bus.action = topic;
}
if (!error && ['tick', 'reset', 'start', 'next', 'stop', 'mode', 'fault', 'online'].includes(topic)) {
  state = model.dispatch(state, topic, value);
  model.setSupply(state, external, available ? bus.packet : null);
}
context.set('estado', state);
bus.frame += topic === 'estado-http' ? 0 : 1;
const snapshot = model.snapshot(state);
const desired = external && available && snapshot.active !== null ? snapshot.active + 1 : 0;
snapshot.transport = {
  nodeRed: true, boot: bus.boot, frame: bus.frame, ticks: bus.ticks, actions: bus.actions, action: bus.action,
  source: bus.source, connected: available, packets: bus.packets, packet: bus.packet, desired
};
snapshot.central = telemetry.summary(central, now);
snapshot.packetTracer = bus.packetTracer ? { ...bus.packetTracer, online: now - bus.packetTracer.at < 9000 } : null;

if (topic === 'estado-http') {
  return [null, httpReply(200, { project: 'RiegoGuard-Tacna', version: 5, state: snapshot }), null];
}

node.status({
  fill: snapshot.lock ? 'red' : external && !available ? 'yellow' : 'green',
  shape: snapshot.active === null ? 'ring' : 'dot',
  text: (external ? 'ESP32 · ' : 'Local · ') + (snapshot.active === null ? 'cerradas' : 'S' + (snapshot.active + 1)) + ' · #' + bus.frame
});
const output = { topic: 'estado', payload: snapshot };
const response = topic === 'esp32'
  ? httpReply(200, 'RG2 ' + desired + ' ' + bus.frame + ' ' + now + '\n', 'text/plain; charset=utf-8')
  : command ? httpReply(error ? 409 : 200, { ok: !error, error, state: snapshot }) : null;
const trace = connectionChanged || (topic !== 'tick' && topic !== 'esp32' && topic !== 'ready')
  || (topic === 'tick' && bus.ticks % 5 === 0);
const diagnostic = trace ? {
  topic: topic || 'inicio',
  payload: {
    trama: bus.frame, reloj: bus.ticks,
    sector: snapshot.active === null ? null : 'S' + (snapshot.active + 1),
    caudal: snapshot.flow, presion: snapshot.pressure, ultimaOrden: bus.action,
    fuente: bus.source, telemetria: bus.packets, esp32EnLinea: available,
    consignaESP32: desired, confirmacionESP32: available ? bus.packet.valve : null
  }
} : null;
return [output, response, diagnostic];
