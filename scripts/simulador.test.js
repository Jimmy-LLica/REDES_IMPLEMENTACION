'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { create, dispatch, snapshot, experiment, CONFIG } = require('../app/simulador');

test('Automatizado abre S1 y cierra al alcanzar el 45 %', () => {
  const state = create();
  dispatch(state, 'start');
  assert.equal(snapshot(state).sectors.filter((item) => item.open).length, 1);
  assert.equal(state.active, 0);
  for (let minute = 0; minute < 40 && state.active !== null; minute++) dispatch(state, 'tick');
  assert.equal(state.active, null);
  assert.ok(state.sectors[0].moisture >= CONFIG.upper);
  assert.match(state.events[0].detail, /45 %/);
});

test('Siguiente turno adelanta solo minutos sin riego y abre el sector que llega a 35 %', () => {
  const state = create();
  dispatch(state, 'start');
  while (state.active !== null) dispatch(state, 'tick');
  const idle = snapshot(state);
  assert.ok(idle.nextMinutes > 0);
  const before = state.minute;
  dispatch(state, 'next');
  const next = snapshot(state);
  assert.equal(state.minute, before + idle.nextMinutes);
  assert.equal(next.total, idle.total);
  assert.equal(next.active, 2);
  assert.ok(state.sectors[2].moisture <= CONFIG.lower);
  assert.equal(next.sectors.filter(({ open }) => open).length, 1);
});

test('Al iniciar fuera del horario se abre el siguiente sector programado', () => {
  const state = create('fixed', CONFIG.scheduleStart + 3);
  dispatch(state, 'start');
  assert.equal(state.minute, CONFIG.scheduleStart + CONFIG.slot);
  assert.equal(state.active, 1);
});

test('Horario fijo completa turnos de 12 minutos en secuencia', () => {
  const state = create('fixed');
  dispatch(state, 'start');
  assert.equal(state.active, 0);
  for (let minute = 0; minute < CONFIG.slot; minute++) dispatch(state, 'tick');
  assert.equal(state.active, null);
  assert.equal(state.sectors[0].liters, CONFIG.slot * CONFIG.flow);
  dispatch(state, 'tick');
  assert.equal(state.active, 1);
});

for (const [fault, title, value, field] of [
  ['flow', 'Caudal bajo', 3, 'flow'],
  ['pressure', 'Presión baja', 0.7, 'pressure']
]) {
  test(title + ' confirma la falla y bloquea la apertura hasta rearmar', () => {
    const state = create();
    dispatch(state, 'start');
    dispatch(state, 'fault', fault);
    assert.equal(snapshot(state)[field], value);
    dispatch(state, 'tick');
    assert.equal(state.active, 0);
    dispatch(state, 'tick');
    assert.equal(state.active, null);
    assert.equal(state.running, false);
    assert.match(state.lock.reason, new RegExp(title));
    assert.equal(snapshot(state).lastSample[field], value);
    assert.equal(snapshot(state)[field], 0);
    dispatch(state, 'start');
    assert.equal(state.active, null);
    dispatch(state, 'fault', 'normal');
    dispatch(state, 'start');
    assert.equal(state.active, 0);
    assert.equal(state.lock, null);
  });
}

test('Sin conexión, el controlador sigue regando y recupera eventos una sola vez', () => {
  const state = create();
  dispatch(state, 'online', false);
  dispatch(state, 'start');
  dispatch(state, 'tick');
  assert.equal(state.total, CONFIG.flow);
  assert.equal(snapshot(state).pending, 3);
  dispatch(state, 'online', true);
  const recovered = snapshot(state);
  assert.equal(recovered.pending, 0);
  assert.equal(recovered.lastSync.count, 3);
  assert.ok(recovered.events.every((event) => !event.pending));
  dispatch(state, 'online', true);
  assert.equal(snapshot(state).confirmed, recovered.confirmed);
});

test('El modo externo aplica las lecturas recibidas y cierra al perder el enlace', () => {
  const state = create();
  state.supply = { flow: 8, pressure: 1.5 };
  dispatch(state, 'start');
  assert.equal(snapshot(state).flow, 8);
  assert.equal(snapshot(state).pressure, 1.5);
  dispatch(state, 'tick');
  assert.equal(state.total, 8);
  dispatch(state, 'source-lost');
  assert.ok(snapshot(state).sectors.every((sector) => !sector.open));
  assert.equal(state.running, false);
  assert.equal(state.events[0].title, 'ESP32 desconectado');
});

test('E4 ejecuta siete días y conserva totales diarios y por sector', () => {
  const results = experiment();
  assert.deepEqual(results.map(({ liters }) => liters), [3864, 4032]);
  for (const result of results) {
    assert.equal(result.daily.length, 7);
    assert.equal(result.liters, result.daily.reduce((total, day) => total + day.liters, 0));
    assert.equal(result.liters, result.sectors.reduce((total, sector) => total + sector.liters, 0));
    assert.equal(result.intensity, result.liters / 2800);
    assert.ok(result.band >= 0 && result.band <= 100);
  }
});
