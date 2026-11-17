'use strict';

(() => {
  const find = (id) => document.getElementById(id);
  const format = (value, digits = 0) => value.toLocaleString('es-ES', {
    minimumFractionDigits: digits, maximumFractionDigits: digits
  });
  const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const set = (id, value) => {
    const element = find(id);
    if (element.textContent !== value) element.textContent = value;
  };
  const serverMode = document.documentElement.dataset.runtime === 'node-red';
  const eventIcons = { info: 'info', water: 'water', warning: 'wifi', alarm: 'alert', success: 'check' };
  let state = RiegoGuard.create();
  let current;
  let eventSignature = '';
  let results;
  let experimentInput;
  let activeView = 'simulation';
  let scene;
  let lastGood = -Infinity;
  let polling = false;
  let busy = false;
  const viewIds = ['simulation', 'parcel3d', 'integration', 'central', 'experiment'];
  const actionLabels = {
    start: 'Iniciar riego', next: 'Siguiente turno', stop: 'Detener riego', reset: 'Reiniciar',
    mode: 'Cambiar estrategia', fault: 'Cambiar condición', online: 'Cambiar enlace de eventos', source: 'Cambiar fuente'
  };

  const sectors = RiegoGuard.snapshot(state).sectors.map(({ id, area }) => {
    const element = document.createElement('article');
    element.className = 'sector';
    element.dataset.sector = id;
    element.innerHTML = `
      <div class="sector-body">
        <div class="sector-head"><span class="sector-id">${icon('leaf')} ${id}</span><span class="sector-area">${area} m²</span></div>
        <div class="sector-reading"><strong></strong><span>Humedad</span></div>
        <div class="moisture-meter" role="meter" aria-label="Humedad de ${id}" aria-valuemin="0" aria-valuemax="100"><span class="fill"></span></div>
      </div>
      <div class="valve"><span>Válvula</span><span class="valve-state"><i></i><b></b></span></div>`;
    find('parcel').append(element);
    return {
      element, value: element.querySelector('.sector-reading strong'), meter: element.querySelector('.moisture-meter'),
      fill: element.querySelector('.fill'), valve: element.querySelector('.valve-state b')
    };
  });
  const sceneSectors = sectors.map(({ element }) => {
    const item = document.createElement('li');
    item.innerHTML = '<b></b><span></span><span class="valve-text"></span>';
    item.querySelector('b').textContent = element.dataset.sector;
    find('scene-sectors').append(item);
    return { item, humidity: item.children[1], valve: item.children[2] };
  });

  const live = () => !serverMode || performance.now() - lastGood < 3500;
  const waitingForEsp = (data) => data.transport?.source === 'wokwi' && !data.transport.connected;

  function applySnapshot(next) {
    if (!next?.transport) throw new Error('La respuesta de Node-RED no incluye el estado del flujo.');
    lastGood = performance.now();
    if (next.transport.boot !== current?.transport?.boot || next.transport.frame >= current.transport.frame) render(next);
  }

  function reportError(message = '') {
    set('command-feedback', message);
    find('command-feedback').hidden = !message;
  }

  async function refresh() {
    if (polling || busy) return;
    polling = true;
    try {
      const response = await fetch('/riegoguard/estado', { cache: 'no-store', signal: AbortSignal.timeout(1600) });
      if (!response.ok) throw new Error();
      const payload = await response.json();
      if (payload.version !== 5) throw new Error();
      applySnapshot(payload.state);
    } catch {
      render(current);
    } finally {
      polling = false;
    }
  }

  async function send(topic, value) {
    if (!serverMode) {
      state = RiegoGuard.dispatch(state, topic, value);
      render(RiegoGuard.snapshot(state));
      return;
    }
    if (busy || !live()) return;
    busy = true;
    reportError();
    renderControls(current);
    try {
      const response = await fetch('/riegoguard/orden', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, value }),
        cache: 'no-store', signal: AbortSignal.timeout(2500)
      });
      const payload = await response.json();
      if (payload.state) applySnapshot(payload.state);
      if (!response.ok || !payload.ok) reportError(payload.error || 'Node-RED rechazó la orden.');
    } catch {
      reportError('No llegó confirmación de Node-RED. Comprueba que el iniciador siga abierto.');
    } finally {
      busy = false;
      render(current);
    }
  }

  function toggleTurn() {
    const readyForNext = current.active === null && !(current.measured && current.mode === 'auto');
    send(current.running ? readyForNext ? 'next' : 'stop' : 'start');
  }

  function showView(view) {
    activeView = view;
    for (const id of viewIds) find(id).hidden = id !== view;
    document.querySelectorAll('[data-view]').forEach((item) => {
      const active = item.dataset.view === view;
      item.classList.toggle('current', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    if (view === 'parcel3d' && !scene) {
      scene = Parcela3D.create(find('scene'), {
        in: find('zoom-in'), out: find('zoom-out'), reset: find('camera-reset')
      });
    }
    scene?.visibility(view === 'parcel3d');
    render(current);
    window.scrollTo(0, 0);
  }

  function registerControls() {
    find('mode').addEventListener('change', (event) => send('mode', event.target.value));
    find('fault').addEventListener('change', (event) => send('fault', event.target.value));
    find('scene-fault').addEventListener('change', (event) => send('fault', event.target.value));
    find('offline').addEventListener('change', (event) => send('online', !event.target.checked));
    find('reset').addEventListener('click', () => send('reset'));
    find('source').addEventListener('change', (event) => send('source', event.target.value));
    find('start').addEventListener('click', toggleTurn);
    find('scene-start').addEventListener('click', toggleTurn);
    find('pause').addEventListener('click', () => send('stop'));
    find('scene-pause').addEventListener('click', () => send('stop'));
    find('scene-controls').addEventListener('click', () => showView('simulation'));
    document.querySelectorAll('[data-view]').forEach((button) =>
      button.addEventListener('click', () => showView(button.dataset.view))
    );
    find('central-download').addEventListener('click', () => {
      const header = 'parcela,origen,estado,muestras_suelo,porcentaje_en_banda,litros_estimados\n';
      const rows = (current.central || []).map((area) => [
        area.name, area.source, area.online ? 'vigente' : 'sin datos vigentes',
        area.samples, area.band?.toFixed(2) ?? '', area.liters.toFixed(3)
      ].join(','));
      download('central-riego.csv', header + rows.join('\n') + '\n');
    });
    find('download').addEventListener('click', () => {
      if (results) download('resultados-E4.csv', RiegoGuard.csv(results, experimentInput));
    });
    find('e4-run').addEventListener('click', captureExperiment);
  }

  function download(name, content) {
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' }));
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderMetrics(data) {
    find('connection').className = 'pill ' + (data.online ? 'online' : 'offline');
    set('connection-label', data.online ? 'En línea' : 'Sin conexión');
    set('clock', `Día ${data.day} · ${data.time}`);
    set('flow', live() ? format(data.flow, 1) : '—');
    set('pressure', live() ? format(data.pressure, 1) : '—');
    for (const [id, unit, low] of [['flow', 'L/min', RiegoGuard.CONFIG.minFlow], ['pressure', 'bar', RiegoGuard.CONFIG.minPressure]]) {
      const tripped = data.lock?.[id] < low;
      find(id + '-caption').classList.toggle('sample-alarm', tripped);
      set(id + '-caption', tripped
        ? 'Al cierre: ' + format(data.lock[id], 1) + ' ' + unit
        : waitingForEsp(data) || !live() ? 'Sin lectura disponible' : 'Disponible: ' + format(data.supply[id], 1) + ' ' + unit);
    }
    set('active', live() ? data.active === null ? '0' : '1' : '—');
    set('total', format(data.total));
    data.sectors.forEach((sector, index) => {
      const view = sectors[index];
      view.element.classList.toggle('is-open', live() && sector.open);
      view.element.classList.toggle('is-dry', sector.below && !sector.open);
      view.element.classList.toggle('is-wet', sector.above);
      const valid = live() && sector.valid;
      const moisture = valid ? format(sector.moisture, data.measured ? 2 : 1) + ' %' : '—';
      view.value.textContent = moisture;
      view.meter.setAttribute('aria-valuenow', valid ? sector.moisture : 0);
      view.meter.setAttribute('aria-valuetext', valid ? moisture : 'Sin lectura válida');
      view.fill.style.width = (valid ? sector.moisture : 0) + '%';
      view.valve.textContent = valid ? sector.open ? 'Abierta' : 'Cerrada' : 'Sin lectura';
    });
  }

  function renderControls(data) {
    find('mode').value = data.mode;
    find('fault').value = data.fault;
    find('scene-fault').value = data.fault;
    find('offline').checked = !data.online;
    for (const id of ['mode', 'fault', 'scene-fault', 'offline', 'reset', 'pause', 'scene-pause']) find(id).disabled = busy || !live();
    const waiting = waitingForEsp(data);
    const irrigating = data.active !== null;
    const waitingSoil = data.running && !irrigating && data.measured && data.mode === 'auto';
    const nextTurn = data.running && !irrigating && !waitingSoil;
    find('pause').hidden = find('scene-pause').hidden = !nextTurn;
    for (const id of ['start', 'scene-start']) {
      find(id).disabled = Boolean(busy || !live() || !data.canRearm || waiting);
      find(id + '-icon').setAttribute('href', irrigating || waitingSoil ? '#i-stop' : '#i-play');
      set(id + '-label', irrigating || waitingSoil ? 'Detener riego' : nextTurn ? 'Siguiente turno' : data.lock ? 'Rearmar e iniciar' : 'Iniciar riego');
    }

    let note = { title: 'Sistema en espera', detail: 'Inicia el riego para activar el controlador.', icon: 'info' };
    if (data.running) {
      const detail = data.nextMinutes > 0
        ? `Todas las válvulas están cerradas. Pulsa Siguiente turno para avanzar ${data.nextMinutes} min virtuales.`
        : 'El próximo sector está listo. Pulsa Siguiente turno para abrir su válvula.';
      note = { title: 'Turno completado', detail, icon: 'activity' };
    }
    if (waitingSoil) note = { title: 'Esperando un sector seco', detail: 'El próximo turno se abre al recibir humedad de suelo válida de 35 % o menos.', icon: 'activity' };
    if (data.active !== null) {
      note = { title: `Regando sector ${data.sectors[data.active].id}`, detail: `${format(data.flow, 1)} L/min · ${format(data.pressure, 1)} bar con la válvula abierta.`, icon: 'water' };
    }
    if (irrigating && (data.flow < RiegoGuard.CONFIG.minFlow || data.pressure < RiegoGuard.CONFIG.minPressure)) {
      note = { title: 'Verificando la conducción', detail: `Lectura fuera de rango · ${format(data.flow, 1)} L/min · ${format(data.pressure, 1)} bar.`, icon: 'alert', kind: 'warning' };
    }
    if (data.online && data.events[0]?.title === 'Conexión restablecida') {
      note = { title: 'Conexión restablecida', detail: `Eventos recuperados: ${data.lastSync.count}.`, icon: 'check' };
    }
    if (!data.online) {
      note = { title: 'Control local disponible', detail: 'Los eventos se guardan en cola hasta restablecer la conexión.', icon: 'wifi', kind: 'warning' };
    }
    if (data.lock) {
      note = {
        title: `Cierre de seguridad · ${data.lock.sector}`,
        detail: data.lock.reason + (data.canRearm ? ' Pulsa Rearmar e iniciar.' : ' Restablece caudal y presión normales para rearmar.'),
        icon: 'alert', kind: 'alarm'
      };
    }
    if (waiting) {
      note = { title: 'ESP32 desconectado', detail: 'En Enlace ESP32, elige Simulador interno para probar el riego mientras restableces Wokwi.', icon: 'wifi', kind: 'warning' };
    }
    if (!live()) {
      note = { title: 'Esperando a Node-RED', detail: 'Los controles se habilitan al recibir una trama. Comprueba que el iniciador esté abierto.', icon: 'wifi', kind: 'warning' };
    }
    for (const [box, prefix] of [['status-note', 'note'], ['scene-status', 'scene-status']]) {
      find(box).className = 'status-note ' + (note.kind || '');
      find(prefix + '-icon').setAttribute('href', '#i-' + note.icon);
      set(prefix + '-title', note.title);
      set(prefix + '-detail', note.detail);
    }
  }

  function renderScene(data) {
    scene?.setState(live() ? data : {
      ...data, active: null, flow: 0, pressure: 0, sectors: data.sectors.map((sector) => ({ ...sector, open: false }))
    });
    if (activeView !== 'parcel3d') return;
    set('clock3d', 'Día ' + data.day + ' · ' + data.time);
    set('scene-source', data.transport?.source === 'wokwi' ? 'Wokwi · suelo modelado e hidráulica' : 'Simulador interno');
    set('scene-flow', live() ? format(data.flow, 1) : '—');
    set('scene-pressure', live() ? format(data.pressure, 1) : '—');
    const spraying = live() && data.active !== null && data.flow > 0 && data.pressure > 0;
    find('scene-spray').hidden = !spraying;
    if (spraying) set('scene-spray-label', data.sectors[data.active].id + ' · Aspersores activos');
    const sample = data.lastSample;
    find('scene-sample').classList.toggle('sample-alarm', Boolean(data.lock));
    let sampleLabel = `Disponible · ${format(data.supply.flow, 1)} L/min · ${format(data.supply.pressure, 1)} bar`;
    if (!live() || waitingForEsp(data)) sampleLabel = 'Sin lectura disponible.';
    else if (data.active !== null) sampleLabel = 'Mínimos de protección · 7 L/min y 1,2 bar';
    else if (sample) sampleLabel = `Última lectura ${sample.sector} · ${format(sample.flow, 1)} L/min · ${format(sample.pressure, 1)} bar`;
    set('scene-sample', sampleLabel);
    data.sectors.forEach((sector, index) => {
      const view = sceneSectors[index];
      view.item.classList.toggle('is-open', live() && sector.open);
      const valid = live() && sector.valid;
      view.humidity.textContent = valid ? format(sector.moisture, data.measured ? 2 : 1) + ' %' : '—';
      view.valve.textContent = valid ? sector.open ? 'Abierta' : 'Cerrada' : 'Sin lectura';
    });
  }

  function renderTransport(data) {
    const transport = data.transport;
    const packet = live() && transport?.connected ? transport.packet : null;
    const active = serverMode && live() && Boolean(transport?.nodeRed);
    set('runtime-title', active ? 'Flujo activo · Node-RED' : serverMode ? 'Esperando a Node-RED' : 'Simulador interno');
    set('runtime-caption', active ? 'Trama ' + format(transport.frame) : serverMode ? 'Esperando estado' : 'Modo autónomo');
    find('runtime-pill').className = 'pill ' + (active ? 'online' : serverMode ? 'offline' : 'neutral');
    set('runtime-pill-label', active ? 'Node-RED activo' : serverMode ? 'Sin respuesta del flujo' : 'Simulador interno');
    find('source').disabled = !active || busy;
    find('source').value = transport?.source || (serverMode ? 'wokwi' : 'local');
    find('local-hint').hidden = serverMode;
    find('external-hint').hidden = !serverMode;
    find('integration-links').hidden = !serverMode;
    find('esp-pill').className = 'pill ' + (packet ? 'online' : transport?.source === 'wokwi' ? 'offline' : 'neutral');
    set('esp-status', packet ? 'ESP32 conectado' : 'Sin telemetría ESP32');
    set('link-subtitle', active ? 'Flujo de Node-RED activo' : 'Demo en navegador');
    set('external-hint-title', packet ? 'Recepción confirmada' : 'Esperando telemetría');
    let linkDetail = 'Abre la carpeta wokwi en VS Code y arranca el ESP32.';
    if (packet) linkDetail = transport.source === 'wokwi'
      ? 'La perilla fija la humedad al moverla. El suelo modelado después cambia con el riego confirmado y el secado.'
      : 'Selecciona ESP32 externo para usar las lecturas y accionar los LEDs de válvula.';
    set('external-hint-detail', linkDetail);
    const valve = (number) => number === 0 ? 'Todas cerradas' : 'S' + number;
    set('frame-count', active ? format(transport.frame) : '—');
    set('tick-count', active ? format(transport.ticks) : '—');
    set('esp-count', active ? format(transport.packets) : '—');
    set('esp-last', packet ? '#' + format(packet.seq) : '—');
    set('desired-valve', active ? valve(transport.desired) : '—');
    set('actual-valve', packet ? valve(packet.valve) : '—');
    set('esp-flow', packet ? format(packet.flow, 1) + ' L/min' : '—');
    set('esp-pressure', packet ? format(packet.pressure, 1) + ' bar' : '—');
    set('esp-temperature', packet?.air.temperature != null ? format(packet.air.temperature, 1) + ' °C' : '—');
    set('esp-air-humidity', packet?.air.humidity != null ? format(packet.air.humidity, 1) + ' %' : '—');
    const soilText = (values, digits) => values.map((value) => value === null ? '—' : format(value, digits) + ' %').join(' / ');
    set('esp-knobs', packet ? soilText(packet.soil, 1) : '—');
    set('esp-soil', packet && data.measured ? soilText(data.sectors.map((sector) => sector.valid ? sector.moisture : null), 2) : '—');
    set('action-count', active ? format(transport.actions) : '—');
    set('last-action', active ? (actionLabels[transport.action] || 'En espera') : '—');
  }

  function renderCentral(data) {
    if (activeView !== 'central') return;
    const areas = data.central || Telemetria.summary({}, 0);
    const connected = serverMode && live();
    set('central-online', areas.filter((area) => connected && area.online).length + ' / ' + areas.length);
    set('central-samples', format(areas.reduce((sum, area) => sum + area.samples, 0)));
    set('central-volume', format(areas.reduce((sum, area) => sum + area.liters, 0), 1));
    find('central-download').disabled = !connected;
    set('central-note', connected
      ? 'Las tarjetas muestran la última telemetría recibida. La banda usa muestras válidas y el volumen se estima entre muestras con la misma válvula abierta. Los datos vencidos quedan como históricos.'
      : 'Abre el panel desde Node-RED y espera la conexión para recibir muestras de Wokwi y Packet Tracer.');
    const packetTracer = data.packetTracer;
    const routes = { esperando: 'esperando estación', alcanzable: 'ruta HTTP disponible', 'sin-respuesta': 'sin respuesta de estación', 'respuesta-invalida': 'respuesta inválida' };
    const pathState = (route, virtual, code) => routes[route] + (virtual ? ' · HTTP virtual ' + virtual : '')
      + (code ? ' · Node-RED HTTP ' + code : '');
    set('packet-status', connected && packetTracer?.online
      ? 'Pasarela conectada. Norte: ' + pathState(packetTracer.norte, packetTracer.virtualNorte, packetTracer.postNorte)
        + '. Sur: ' + pathState(packetTracer.sur, packetTracer.virtualSur, packetTracer.postSur) + '.'
      : connected ? 'Sin señal de la pasarela. Abre RiegoGuard-Red.pkt en Realtime, comprueba los programas y permite el acceso HTTP local en Packet Tracer.'
        : 'Abre la central desde Node-RED para comprobar el enlace.');
    const reading = (value, unit) => value == null ? '—' : format(value, 1) + unit;
    find('farm-grid').innerHTML = areas.map((area) => {
      const currentData = connected && area.online;
      const status = currentData ? 'Vigente' : area.last ? 'Vencida' : 'Sin datos';
      const source = area.source === 'wokwi' ? 'ESP32 · Wokwi' : 'Red · Packet Tracer';
      const soil = (area.last?.soil || [null, null, null, null]).map((value, index) =>
        '<span><b>S' + (index + 1) + '</b>' + reading(value, ' %') + '</span>'
      ).join('');
      const modeled = currentData && area.source === 'wokwi' && data.measured
        ? '<p class="farm-age">Suelo modelado S1–S4: ' + data.sectors.map((sector) => sector.valid ? format(sector.moisture, 2) + ' %' : '—').join(' · ') + '</p>'
        : '';
      return `<article class="card farm-card">
        <div class="card-heading"><div><h2>${area.name}</h2><p>${source}</p></div><span class="pill ${currentData ? 'online' : area.last ? 'offline' : 'neutral'}"><i></i>${status}</span></div>
        <div class="farm-moisture" aria-label="Humedad de suelo por sector">${soil}</div>
        ${modeled}
        <dl class="protocol-stats">
          <div><dt>Temperatura</dt><dd>${reading(area.last?.air.temperature, ' °C')}</dd></div>
          <div><dt>Humedad del aire</dt><dd>${reading(area.last?.air.humidity, ' %')}</dd></div>
          <div><dt>Caudal</dt><dd>${reading(area.last?.flow, ' L/min')}</dd></div>
          <div><dt>Presión</dt><dd>${reading(area.last?.pressure, ' bar')}</dd></div>
          <div><dt>Muestras en banda</dt><dd>${reading(area.band, ' %')}</dd></div>
          <div><dt>Volumen estimado</dt><dd>${reading(area.liters, ' L')}</dd></div>
        </dl>
        <p class="farm-age">${area.last ? 'Última muestra hace ' + format(area.age / 1000, 1) + ' s · ' + format(area.packets) + ' paquetes' : 'Esperando el primer paquete'}</p>
      </article>`;
    }).join('');
  }

  function renderEvents(data) {
    find('queue').className = 'pill ' + (data.pending ? 'queued' : 'neutral');
    set('queue-label', data.pending === 1 ? '1 pendiente' : data.pending + ' pendientes');
    const signature = JSON.stringify(data.events);
    if (eventSignature === signature) return;
    eventSignature = signature;
    const items = data.events.map((event) => {
      const item = document.createElement('li');
      item.className = 'event';
      item.innerHTML = `
        <span class="event-icon">${icon(eventIcons[event.kind] || 'info')}</span>
        <div><strong></strong><p></p></div><div class="event-meta"><time></time><span></span></div>`;
      item.querySelector('.event-icon').classList.add(event.kind);
      item.querySelector('strong').textContent = event.title;
      item.querySelector('p').textContent = event.detail;
      item.querySelector('time').textContent = `D${event.day} · ${event.time}`;
      const transmission = item.querySelector('.event-meta span');
      transmission.classList.toggle('pending', event.pending);
      transmission.textContent = event.pending ? 'Pendiente' : 'Confirmado';
      return item;
    });
    find('events').replaceChildren(...items);
  }

  function render(data) {
    current = data;
    renderMetrics(data);
    renderControls(data);
    renderEvents(data);
    renderScene(data);
    renderTransport(data);
    renderCentral(data);
    if (activeView === 'experiment') {
      const ready = canCapture(data);
      find('e4-run').disabled = !ready;
      if (!results) set('e4-input', ready
        ? 'Captura el estado actual de los cuatro sectores y la conducción para iniciar la comparación.'
        : 'E4 espera lecturas vigentes de los cuatro sectores. Arranca Wokwi y comprueba Enlace ESP32.');
    }
  }

  function canCapture(data) {
    return live() && !waitingForEsp(data) && data.sectors.every((sector) => sector.valid);
  }

  function captureExperiment() {
    if (!canCapture(current)) return;
    const packet = current.measured ? current.transport.packet : null;
    experimentInput = {
      source: packet ? 'Wokwi' : 'Simulador interno',
      captured: new Date().toISOString(), seq: packet?.seq,
      soil: current.sectors.map((sector) => sector.moisture), ...current.supply
    };
    results = RiegoGuard.experiment(experimentInput);
    const { source, soil, flow, pressure } = experimentInput;
    const values = soil.map((value, index) => 'S' + (index + 1) + ' ' + format(value, 2) + ' %').join(' · ');
    set('e4-input', source + (packet ? ' #' + packet.seq : '') + ' · ' + values + ' · '
      + format(flow, 2) + ' L/min · ' + format(pressure, 2) + ' bar · ' + new Date(experimentInput.captured).toLocaleString('es-PE'));
    find('download').disabled = false;
    find('e4-daily').hidden = false;
    renderExperiment();
  }

  function renderExperiment() {
    find('summary').innerHTML = results.map((result) => `
      <article class="card score ${result.mode}">
        <h2>${result.label}</h2>
        <div class="score-metrics">
          <div><span>Consumo promedio</span><strong>${format(result.intensity, 2)}</strong> <small>L/m²/día</small></div>
          <div><span>Tiempo en banda</span><strong>${format(result.band, 1)} %</strong></div>
        </div>
        <div class="score-meter" aria-hidden="true"><span style="width:${result.band}%"></span></div>
        <p>${format(result.liters, 1)} L proyectados en siete días</p>
      </article>`).join('');
    const [auto, fixed] = results;
    find('daily-results').innerHTML = auto.daily.map((day, index) => `
      <tr><th scope="row">Día ${day.day}</th><td>${format(day.intensity, 2)}</td><td>${format(day.band, 1)} %</td>
        <td>${format(fixed.daily[index].intensity, 2)}</td><td>${format(fixed.daily[index].band, 1)} %</td></tr>`).join('');
  }

  registerControls();
  render(RiegoGuard.snapshot(state));
  const requestedView = new URL(location.href).searchParams.get('view');
  if (viewIds.includes(requestedView)) showView(requestedView);
  if (serverMode) {
    find('native-link').hidden = false;
    const base = new URL(document.baseURI);
    const port = base.port || (base.protocol === 'https:' ? '443' : '80');
    set('esp-endpoint', 'POST http://host.wokwi.internal:' + port + '/riegoguard/esp32');
    refresh();
    setInterval(refresh, 500);
  } else {
    setInterval(() => send('tick'), 1000);
  }
})();
