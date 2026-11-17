'use strict';

const RiegoGuard = (() => {
  const SECTORS = [
    { id: 'S1', area: 100, initial: 34, drying: 3.2 },
    { id: 'S2', area: 100, initial: 38, drying: 3.8 },
    { id: 'S3', area: 100, initial: 36.5, drying: 4.4 },
    { id: 'S4', area: 100, initial: 41, drying: 3.5 }
  ];
  const CONFIG = Object.freeze({
    lower: 35, upper: 45, flow: 12, pressure: 1.8, minFlow: 7, minPressure: 1.2,
    confirmationMinutes: 2, gain: 0.35, scheduleStart: 360, slot: 12, days: 7,
    knobDelta: 0.5, maxAutoMinutes: 240
  });
  const MODES = { auto: 'Automatizado', fixed: 'Horario fijo' };
  const FAULTS = { normal: 'Normal', flow: 'Caudal bajo', pressure: 'Presión baja' };
  const DAY = 1440;
  const liquid = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
  const clock = (minute) => {
    const hours = String(Math.floor((minute % DAY) / 60)).padStart(2, '0');
    const minutes = String(minute % 60).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  function create(mode = 'auto', minute = CONFIG.scheduleStart, record = true) {
    const state = {
      mode, minute, running: false, online: true, fault: 'normal', active: null,
      lock: null, supply: null, measured: false, sampleKey: null, soilBoot: null, lastSample: null,
      openedAt: null,
      abnormalMinutes: 0, total: 0, sequence: 0, confirmed: 0,
      events: [], pending: [], lastSync: null, record,
      sectors: SECTORS.map(({ id, area, initial, drying }) => ({
        id, area, moisture: initial, drying, liters: 0, valid: true, knob: null
      }))
    };
    log(state, 'Sistema listo', 'Controlador ESP32 simulado. Válvulas cerradas.', 'info');
    return state;
  }

  function log(state, title, detail, kind = 'info') {
    if (!state.record) return;
    const event = { id: ++state.sequence, minute: state.minute, title, detail, kind };
    if (state.online) {
      state.confirmed++;
    } else {
      state.pending.push(event);
    }
    state.events.unshift(event);
    state.events.length = Math.min(state.events.length, 100);
  }

  function upstream(state) {
    const flow = state.supply?.flow ?? CONFIG.flow;
    const pressure = state.supply?.pressure ?? CONFIG.pressure;
    return {
      flow: state.fault === 'flow' ? Math.min(3, flow) : flow,
      pressure: state.fault === 'pressure' ? Math.min(0.7, pressure) : pressure
    };
  }

  function readings(state) {
    return state.active === null ? { flow: 0, pressure: 0 } : upstream(state);
  }

  function saveSample(state) {
    if (state.active === null) return;
    state.lastSample = { ...readings(state), sector: state.sectors[state.active].id, time: clock(state.minute) };
  }

  function openValve(state, sector) {
    state.active = sector;
    state.openedAt = state.minute;
    state.abnormalMinutes = 0;
    if (state.record) saveSample(state);
    const reason = state.mode === 'auto' ? 'Umbral de apertura alcanzado.' : 'Inicio del turno programado.';
    log(state, `Válvula ${state.sectors[sector].id} abierta`, reason, 'water');
  }

  function closeValve(state, reason, kind = 'info') {
    if (state.active === null) return;
    const id = state.sectors[state.active].id;
    state.active = null;
    state.openedAt = null;
    state.abnormalMinutes = 0;
    log(state, `Válvula ${id} cerrada`, reason, kind);
  }

  function selectValve(state) {
    if (!state.running || state.lock || state.active !== null) return;
    if (state.mode === 'fixed') {
      const offset = (state.minute % DAY) - CONFIG.scheduleStart;
      if (offset >= 0 && offset < SECTORS.length * CONFIG.slot && offset % CONFIG.slot === 0) {
        const sector = offset / CONFIG.slot;
        if (state.sectors[sector].valid) openValve(state, sector);
      }
      return;
    }
    const sector = state.sectors.reduce((driest, item, index) => (
      item.valid && item.moisture <= CONFIG.lower && (driest === null || item.moisture < state.sectors[driest].moisture)
        ? index : driest
    ), null);
    if (sector !== null) openValve(state, sector);
  }

  function waitMinutes(state) {
    if (state.mode === 'fixed') {
      const offset = state.minute % DAY - CONFIG.scheduleStart;
      if (offset < 0) return -offset;
      const next = Math.ceil(offset / CONFIG.slot) * CONFIG.slot;
      return next < SECTORS.length * CONFIG.slot ? next - offset : DAY - offset;
    }
    if (state.measured) return null;
    return Math.max(0, Math.min(...state.sectors.map(({ moisture, drying }) =>
      Math.ceil((moisture - CONFIG.lower) * DAY / drying)
    )));
  }

  function openNextTurn(state) {
    if (!state.running || state.lock || state.active !== null) return;
    const minutes = waitMinutes(state);
    if (minutes > 0) {
      for (const sector of state.sectors) {
        if (state.measured && !sector.valid) continue;
        const moisture = sector.moisture - sector.drying * minutes / DAY;
        sector.moisture = Math.abs(moisture - CONFIG.lower) < 1e-8 ? CONFIG.lower : Math.max(0, moisture);
      }
      state.minute += minutes;
      log(state, 'Reloj adelantado', `Se omitieron ${minutes} minutos virtuales sin riego hasta el siguiente turno.`);
    }
    selectValve(state);
  }

  function confirmHydraulics(state) {
    if (state.active === null) return;
    if (state.record) saveSample(state);
    const sample = readings(state);
    const lowFlow = sample.flow < CONFIG.minFlow;
    const lowPressure = sample.pressure < CONFIG.minPressure;
    state.abnormalMinutes = lowFlow || lowPressure ? state.abnormalMinutes + 1 : 0;
    if (state.abnormalMinutes < CONFIG.confirmationMinutes) return;
    const reason = lowFlow
      ? `Caudal bajo · ${sample.flow} L/min (mín. ${CONFIG.minFlow} L/min).`
      : `Presión baja · ${liquid.format(sample.pressure)} bar (mín. ${liquid.format(CONFIG.minPressure)} bar).`;
    state.lock = { sector: state.sectors[state.active].id, reason, ...sample };
    state.running = false;
    closeValve(state, reason, 'alarm');
  }

  function canRearm(state) {
    if (!state.lock) return true;
    const { flow, pressure } = upstream(state);
    return state.fault === 'normal' && (!state.measured || state.supply !== null)
      && flow >= CONFIG.minFlow && pressure >= CONFIG.minPressure;
  }

  function setSupply(state, measured, packet) {
    if (state.measured !== measured) {
      state.sampleKey = null;
      state.soilBoot = null;
    }
    state.measured = measured;
    state.supply = measured ? packet : null;
    if (!measured || !packet) {
      for (const sector of state.sectors) sector.valid = !measured;
      return;
    }
    const key = packet.boot + ':' + packet.seq;
    if (state.sampleKey === key) return;
    state.sampleKey = key;
    const newBoot = state.soilBoot !== packet.boot;
    state.soilBoot = packet.boot;
    state.sectors.forEach((sector, index) => {
      const value = packet.soil[index];
      if (value !== null && (newBoot || sector.knob === null || Math.abs(value - sector.knob) >= CONFIG.knobDelta - 1e-8)) {
        sector.moisture = value;
        sector.knob = value;
      }
      if (value === null) sector.knob = null;
      sector.valid = value !== null;
    });
    if (state.active === null) return;
    const sector = state.sectors[state.active];
    if (!sector.valid) closeValve(state, 'Humedad de suelo sin lectura válida.', 'alarm');
    else if (state.mode === 'auto' && sector.moisture >= CONFIG.upper) {
      closeValve(state, `Objetivo del ${CONFIG.upper} % alcanzado.`, 'success');
    } else confirmHydraulics(state);
  }

  function step(state) {
    if (!state.running) {
      if (state.measured && state.supply) applySoilMinute(state, 0);
      return;
    }
    selectValve(state);
    if (!state.measured) confirmHydraulics(state);
    const confirmed = !state.measured || (state.active !== null && state.supply?.valve === state.active + 1);
    applySoilMinute(state, confirmed ? readings(state).flow : 0);
    state.minute++;

    if (state.active === null) return;
    if (state.mode === 'auto' && state.sectors[state.active].moisture >= CONFIG.upper) {
      closeValve(state, `Objetivo del ${CONFIG.upper} % alcanzado.`, 'success');
    } else if (state.mode === 'auto' && state.minute - state.openedAt >= CONFIG.maxAutoMinutes) {
      const reason = `Límite de ${CONFIG.maxAutoMinutes} minutos virtuales sin alcanzar la humedad objetivo.`;
      state.lock = { sector: state.sectors[state.active].id, reason, ...readings(state) };
      state.running = false;
      closeValve(state, reason, 'alarm');
    } else if (state.mode === 'fixed' && (state.minute % DAY - CONFIG.scheduleStart) % CONFIG.slot === 0) {
      closeValve(state, 'Turno programado completado.', 'success');
    }
  }

  function applySoilMinute(state, flow) {
    state.sectors.forEach((sector, index) => {
      const applied = index === state.active ? flow : 0;
      if (sector.valid) {
        const moisture = sector.moisture - sector.drying / DAY + CONFIG.gain * applied / CONFIG.flow;
        sector.moisture = Math.min(100, Math.max(0, moisture));
      }
      sector.liters += applied;
      state.total += applied;
    });
  }

  function dispatch(state, topic, value) {
    switch (topic) {
      case 'tick':
        step(state);
        break;
      case 'start':
        if (state.running || !canRearm(state)) break;
        if (state.lock) log(state, 'Protección rearmada', 'Condición hidráulica normal.', 'success');
        state.lock = null;
        state.running = true;
        log(state, 'Riego iniciado', MODES[state.mode] + '.', 'water');
        openNextTurn(state);
        break;
      case 'next':
        openNextTurn(state);
        break;
      case 'stop':
        if (!state.running) break;
        closeValve(state, 'Parada manual.');
        state.running = false;
        log(state, 'Riego detenido', 'El reloj de la simulación está en pausa.');
        break;
      case 'source-lost':
        closeValve(state, 'Se perdió la telemetría del ESP32.', 'alarm');
        state.running = false;
        log(state, 'ESP32 desconectado', 'Válvulas cerradas. Reanuda el riego cuando vuelva la telemetría.', 'alarm');
        break;
      case 'source':
        closeValve(state, 'Cambio de fuente de control.');
        state.running = false;
        log(state, 'Fuente de control actualizada', value);
        break;
      case 'reset':
        return create();
      case 'mode':
        if (!Object.hasOwn(MODES, value) || state.mode === value) break;
        closeValve(state, 'Cambio de estrategia.');
        state.running = false;
        state.mode = value;
        log(state, 'Estrategia actualizada', MODES[value] + '.');
        break;
      case 'fault':
        if (!Object.hasOwn(FAULTS, value) || state.fault === value) break;
        state.fault = value;
        state.abnormalMinutes = 0;
        if (state.record) saveSample(state);
        log(state, 'Escenario actualizado', FAULTS[value] + '.');
        break;
      case 'online':
        if (typeof value !== 'boolean' || state.online === value) break;
        state.online = value;
        if (!value) {
          log(state, 'Conexión interrumpida', 'El control local sigue disponible. Los eventos quedan en cola.', 'warning');
          break;
        }
        state.lastSync = { count: state.pending.length, minute: state.minute };
        state.confirmed += state.pending.length;
        state.pending = [];
        log(state, 'Conexión restablecida', `Eventos recuperados: ${state.lastSync.count}.`, 'success');
        break;
    }
    return state;
  }

  function snapshot(state) {
    const pending = state.pending.map(({ id }) => id);
    const pendingIds = new Set(pending);
    return {
      mode: state.mode, running: state.running, fault: state.fault, active: state.active,
      online: state.online, lock: state.lock, pending: pending.length, confirmed: state.confirmed,
      total: state.total, lastSync: state.lastSync,
      day: Math.floor(state.minute / DAY) + 1, time: clock(state.minute), ...readings(state),
      supply: upstream(state), lastSample: state.lastSample, measured: state.measured, canRearm: canRearm(state),
      nextMinutes: state.active === null && !state.lock ? waitMinutes(state) : null,
      sectors: state.sectors.map((sector, index) => ({
        id: sector.id, area: sector.area, moisture: Number(sector.moisture.toFixed(2)),
        open: index === state.active, valid: sector.valid, below: sector.moisture < CONFIG.lower,
        above: sector.moisture > CONFIG.upper, liters: sector.liters
      })),
      events: state.events.slice(0, 20).map((event) => ({
        ...event, time: clock(event.minute), day: Math.floor(event.minute / DAY) + 1,
        pending: pendingIds.has(event.id)
      }))
    };
  }

  function experiment(input = null) {
    if (input && (!Array.isArray(input.soil) || input.soil.length !== SECTORS.length
      || input.soil.some((value) => !Number.isFinite(value) || value < 0 || value > 100)
      || !Number.isFinite(input.flow) || input.flow < 0 || input.flow > CONFIG.flow
      || !Number.isFinite(input.pressure) || input.pressure < 0 || input.pressure > CONFIG.pressure)) {
      throw new RangeError('E4 requiere cuatro humedades e hidráulica válidas.');
    }
    const area = SECTORS.reduce((sum, sector) => sum + sector.area, 0);
    const minutes = CONFIG.days * DAY;
    return ['auto', 'fixed'].map((mode) => {
      const state = create(mode, 0, false);
      if (input) {
        state.sectors.forEach((sector, index) => { sector.moisture = input.soil[index]; });
        state.supply = { flow: input.flow, pressure: input.pressure };
      }
      state.running = true;
      const inBand = SECTORS.map(() => 0);
      const daily = [];
      let dailyBaseline = 0;
      let dailyBand = 0;
      for (let minute = 1; minute <= minutes; minute++) {
        step(state);
        state.sectors.forEach(({ moisture }, index) => {
          if (moisture >= CONFIG.lower && moisture <= CONFIG.upper) {
            inBand[index]++;
            dailyBand++;
          }
        });
        if (minute % DAY === 0) {
          daily.push({
            day: minute / DAY,
            liters: state.total - dailyBaseline,
            intensity: (state.total - dailyBaseline) / area,
            band: dailyBand * 100 / (DAY * SECTORS.length)
          });
          dailyBaseline = state.total;
          dailyBand = 0;
        }
      }
      return {
        mode, label: MODES[mode], liters: state.total, intensity: state.total / (area * CONFIG.days),
        band: inBand.reduce((sum, count) => sum + count, 0) * 100 / (minutes * SECTORS.length),
        daily,
        sectors: state.sectors.map((sector, index) => ({
          id: sector.id, liters: sector.liters, bandMinutes: inBand[index], band: inBand[index] * 100 / minutes
        }))
      };
    });
  }

  function csv(results = experiment(), input = null) {
    const rows = [['estrategia', 'periodo', 'litros', 'litros_m2_dia', 'tiempo_en_banda_pct']];
    for (const result of results) {
      rows.push([result.label, '7 días', result.liters, result.intensity.toFixed(4), result.band.toFixed(4)]);
      for (const day of result.daily) {
        rows.push([result.label, `Día ${day.day}`, day.liters, day.intensity.toFixed(4), day.band.toFixed(4)]);
      }
    }
    if (input) {
      rows[0].push('origen', 'captura_utc', 'secuencia_wokwi', 's1_inicial_pct', 's2_inicial_pct', 's3_inicial_pct',
        's4_inicial_pct', 'caudal_disponible_l_min', 'presion_disponible_bar');
      for (const row of rows.slice(1)) row.push(input.source, input.captured, input.seq ?? '', ...input.soil, input.flow, input.pressure);
    }
    return rows.map((row) => row.join(',')).join('\r\n') + '\r\n';
  }

  return { CONFIG, MODES, FAULTS, create, dispatch, snapshot, experiment, csv, setSupply, canRearm };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RiegoGuard;
