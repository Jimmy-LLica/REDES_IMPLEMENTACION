'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../app/simulador');
const telemetry = require('../app/telemetria');
const time = 1800000000000;
const message = (extra = {}) => ({
  v: 2, farm: 'tacna-centro', boot: 'sesion-1', seq: 1, sampledAt: time,
  valve: 1, flow: 12, pressure: 1.8, soil: [33, 38, 40, 46],
  air: { temperature: 24, humidity: 57 }, ...extra
});

test('Telemetría descarta muestras duplicadas, fuera de orden, vencidas y de otro origen', () => {
  const store = {};
  const accept = (packet, now = time) => telemetry.accept(store, packet, 'wokwi', now, model.CONFIG);
  assert.ok(accept(message({ seq: 8 })).packet);
  assert.equal(accept(message({ seq: 8 })).status, 409);
  assert.equal(accept(message({ seq: 7 })).status, 409);
  assert.equal(accept(message({ seq: 9 }), time + 4200).status, 409);
  assert.equal(accept(message({ farm: 'tacna-norte' })).status, 400);
  assert.equal(store['tacna-centro'].packets, 1);
  assert.equal(store['tacna-centro'].last.seq, 8);
});

test('Central conserva métricas y distingue la pérdida de una parcela de las otras', () => {
  const store = {};
  function ingest(farm, seq, timestamp) {
    assert.ok(telemetry.accept(store, message({ farm, seq, sampledAt: timestamp }),
      'packet-tracer', timestamp, model.CONFIG).packet);
  }
  ingest('tacna-norte', 1, time);
  ingest('tacna-norte', 2, time + 2000);
  ingest('tacna-sur', 1, time + 10000);
  const [, north, south] = telemetry.summary(store, time + 11000);
  assert.equal(north.online, false);
  assert.equal(south.online, true);
  assert.equal(north.liters, .4);
  assert.equal(north.band, 50);
  assert.equal(north.samples, 8);
});

test('Una perilla nueva en Wokwi puede cambiar el suelo o invalidar su sector', () => {
  const state = model.create();
  model.setSupply(state, true, message({ soil: [40, 34, 30, 40] }));
  model.dispatch(state, 'start');
  assert.equal(state.active, 2);
  model.dispatch(state, 'tick');
  assert.ok(state.sectors[2].moisture < 30);
  model.setSupply(state, true, message({ seq: 2, soil: [40, 34, 45, 40] }));
  assert.equal(state.active, null);
  model.dispatch(state, 'tick');
  assert.equal(state.active, 1);
  model.setSupply(state, true, message({ seq: 3, soil: [40, null, 45, 40] }));
  assert.equal(state.active, null);
  assert.equal(model.snapshot(state).sectors[1].valid, false);
});

for (const sector of [0, 1, 2, 3]) {
  test('S' + (sector + 1) + ' sube al regar con Wokwi y se seca con la perilla quieta', () => {
    const state = model.create();
    const soil = [43, 43, 43, 43];
    soil[sector] = 34;
    let seq = 1;
    const supply = (valve, values = soil) => model.setSupply(state, true, message({ seq: seq++, soil: values, valve }));
    supply(0);
    model.dispatch(state, 'start');
    assert.equal(state.active, sector);
    model.dispatch(state, 'tick');
    assert.equal(state.total, 0);
    assert.ok(state.sectors[sector].moisture < 34);
    for (let minute = 0; state.active === sector && minute < 37; minute++) {
      supply(sector + 1);
      model.dispatch(state, 'tick');
    }
    assert.equal(state.active, null);
    const wet = state.sectors[sector].moisture;
    assert.ok(wet >= 45 && wet < 46);
    assert.match(state.events[0].detail, /45 %/);
    supply(0);
    model.dispatch(state, 'stop');
    for (let minute = 0; minute < 60; minute++) {
      supply(0);
      model.dispatch(state, 'tick');
    }
    assert.ok(state.sectors[sector].moisture < wet);
    assert.ok(state.sectors[sector].moisture > 44);
    const newSoil = [...soil];
    newSoil[sector] = 32;
    supply(0, newSoil);
    assert.equal(state.sectors[sector].moisture, 32);
  });
}

test('E4 alimenta ambas estrategias con una captura del suelo y la hidráulica', () => {
  const input = { source: 'Wokwi', captured: '2026-11-16T00:00:00.000Z', seq: 42, soil: [50, 39, 31, 44], flow: 10, pressure: 1.6 };
  const results = model.experiment(input);
  assert.notEqual(results[0].liters, model.experiment()[0].liters);
  assert.equal(results[1].liters, 10 * 12 * 4 * 7);
  assert.match(model.csv(results, input), /Wokwi,2026-11-16T00:00:00.000Z,42,50,39,31,44,10,1.6/);
});

test('El límite de apertura bloquea el riego si el ESP32 nunca confirma la válvula', () => {
  const state = model.create();
  model.setSupply(state, true, message({ valve: 0 }));
  model.dispatch(state, 'start');
  for (let i = 0; i < model.CONFIG.maxAutoMinutes; i++) model.dispatch(state, 'tick');
  assert.equal(state.active, null);
  assert.equal(state.running, false);
  assert.equal(state.total, 0);
  assert.match(state.lock.reason, /Límite/);
});

test('La protección requiere dos muestras distintas y rearme hidráulico válido', () => {
  const state = model.create();
  model.setSupply(state, true, message());
  model.dispatch(state, 'start');
  const first = message({ seq: 2, flow: 3 });
  model.setSupply(state, true, first);
  model.dispatch(state, 'tick');
  model.setSupply(state, true, first);
  model.dispatch(state, 'tick');
  assert.equal(state.active, 0);
  model.setSupply(state, true, message({ seq: 3, flow: 3 }));
  assert.equal(state.active, null);
  assert.equal(model.canRearm(state), false);
  model.dispatch(state, 'start');
  assert.equal(state.running, false);
  model.setSupply(state, true, message({ seq: 4 }));
  assert.equal(model.canRearm(state), true);
  model.dispatch(state, 'start');
  assert.equal(state.active, 0);
});

test('La pasarela solo reenvía parcelas con una respuesta HTTP en la red simulada', () => {
  const forwarded = [];
  const source = fs.readFileSync(path.resolve(__dirname, '../packet-tracer/pasarela.js'), 'utf8');
  const sandbox = vm.createContext({
    Serial: { println() {} }, delay() {},
    HTTPClient: class {
      stop() {}
      open(url) {
        const north = url.includes('10.40.10.10');
        this.onDone(north ? 200 : 0, north ? JSON.stringify(message({ farm: 'tacna-norte' })) : '');
      }
    },
    RealHTTPClient: class {
      postWithHeader(url, data) {
        forwarded.push({ url, data });
        this.onDone(200);
      }
    }
  });
  vm.runInContext(source + '\nsetup(); loop();', sandbox);
  assert.deepEqual(forwarded.map(({ data }) => data.farm).filter(Boolean), ['tacna-norte']);
  assert.equal(forwarded[0].url, 'http://127.0.0.1:1880/riegoguard/red');
  assert.equal(forwarded[1].data.norte, 'alcanzable');
  assert.equal(forwarded[1].data.sur, 'sin-respuesta');
});
