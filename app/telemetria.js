'use strict';

const Telemetria = (() => {
  const AREAS = Object.freeze({
    'tacna-centro': { name: 'Tacna Centro', source: 'wokwi', ttl: 4200 },
    'tacna-norte': { name: 'Tacna Norte', source: 'packet-tracer', ttl: 8500 },
    'tacna-sur': { name: 'Tacna Sur', source: 'packet-tracer', ttl: 8500 }
  });
  const between = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const present = (value, min, max) => value === null || between(value, min, max);

  function accept(store, data, source, now, config) {
    const reject = (error, status = 400) => ({ error, status });
    if (!data || data.v !== 2) return reject('Se requiere telemetría v2 con humedad S1–S4.');
    const area = Object.hasOwn(AREAS, data.farm) ? AREAS[data.farm] : null;
    if (!area || area.source !== source || typeof data.boot !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(data.boot)
      || !Number.isSafeInteger(data.seq) || !between(data.seq, 1, 4294967295)
      || !Number.isInteger(data.valve) || !between(data.valve, 0, 4)
      || !between(data.flow, 0, config.flow) || !between(data.pressure, 0, config.pressure)
      || !Array.isArray(data.soil) || data.soil.length !== 4 || !data.soil.every((value) => present(value, 0, 100))
      || !data.air || !present(data.air.temperature, -40, 80) || !present(data.air.humidity, 0, 100)) {
      return reject('Campos o parcela inválidos.');
    }
    if (source === 'wokwi' && data.sampledAt === 0) return { sync: true };
    if (!Number.isSafeInteger(data.sampledAt) || data.sampledAt <= 0
      || data.sampledAt > now + 1500 || now - data.sampledAt >= area.ttl) {
      return reject('Muestra vencida o reloj fuera de rango.', 409);
    }
    const entry = store[data.farm] || { packets: 0, samples: 0, inBand: 0, liters: 0, last: null, retired: [] };
    const previous = entry.last;
    if (previous && (entry.retired.includes(data.boot) || data.sampledAt < previous.sampledAt
      || (data.boot === previous.boot && data.seq <= previous.seq)
      || (data.boot !== previous.boot && data.sampledAt <= previous.sampledAt))) {
      return reject('Muestra repetida o fuera de orden.', 409);
    }
    if (previous?.boot !== undefined && previous.boot !== data.boot) {
      entry.retired = [...entry.retired, previous.boot].slice(-16);
    }
    const elapsed = previous ? data.sampledAt - previous.sampledAt : 0;
    if (previous?.boot === data.boot && data.valve > 0 && data.valve === previous.valve && elapsed > 0 && elapsed < area.ttl) {
      entry.liters += (previous.flow + data.flow) * elapsed / 120000;
    }
    for (const moisture of data.soil) {
      if (moisture === null) continue;
      entry.samples++;
      if (moisture >= config.lower && moisture <= config.upper) entry.inBand++;
    }
    entry.packets++;
    const packet = {
      boot: data.boot, seq: data.seq, valve: data.valve, flow: data.flow, pressure: data.pressure,
      soil: data.soil, air: { temperature: data.air.temperature, humidity: data.air.humidity },
      sampledAt: data.sampledAt, at: now
    };
    entry.last = packet;
    store[data.farm] = entry;
    return { packet, entry };
  }

  function available(packet, area, now) {
    return Boolean(packet && now - packet.sampledAt < AREAS[area].ttl && now - packet.at < AREAS[area].ttl);
  }

  function summary(store, now) {
    return Object.entries(AREAS).map(([id, area]) => {
      const item = store[id];
      const last = item?.last || null;
      const soil = last?.soil.filter((value) => value !== null) || [];
      return {
        id, name: area.name, source: area.source, last, online: available(last, id, now),
        age: last ? Math.max(0, now - last.sampledAt) : null,
        packets: item?.packets ?? 0, samples: item?.samples ?? 0, liters: item?.liters ?? 0,
        band: item?.samples ? 100 * item.inBand / item.samples : null,
        meanSoil: soil.length ? soil.reduce((sum, value) => sum + value, 0) / soil.length : null
      };
    });
  }

  return { accept, available, summary };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Telemetria;
