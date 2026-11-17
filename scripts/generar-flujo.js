'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const model = read('app/simulador.js');
const telemetry = read('app/telemetria.js');
const html = read('index.html')
  .replace('<html lang="es">', '<html lang="es" data-runtime="node-red">')
  .replace('<link rel="stylesheet" href="app/panel.css">', () => '<style>' + read('app/panel.css') + '</style>')
  .replace(/<script src="(app\/[^"]+)"><\/script>/g, (_, file) => '<script>' + read(file) + '</script>');
const panel = `
<template>
  <Teleport to="body">
    <iframe class="riegoguard-frame" src="/riegoguard/panel" title="Panel de RiegoGuard Tacna"></iframe>
  </Teleport>
</template>
<style>
.riegoguard-frame { position: fixed; inset: 0; border: 0; width: 100vw; height: 100dvh; background: #f4f6f3; z-index: 2500; }
html:has(.riegoguard-frame) { overflow: hidden; }
body:has(> .riegoguard-frame) #app { visibility: hidden; }
</style>`;

const tab = 'rg-simulation';
const ui = 'rg-dashboard';
const theme = 'rg-theme';
const editorNode = (id, type, properties) => ({ id, type, z: tab, ...properties });
const group = (id, page, name, order, width, showTitle = true) => ({
  id, type: 'ui-group', page, name, order, width, height: 1, showTitle, visible: true, disabled: false,
  groupType: 'default', keepLoaded: false, className: ''
});
const page = (id, name, route, order, icon) => ({
  id, type: 'ui-page', name, ui, path: route, icon, layout: 'grid', theme, order, className: '', visible: 'true', disabled: 'false',
  breakpoints: [{ name: 'Móvil', px: 0, cols: 6 }, { name: 'Escritorio', px: 768, cols: 12 }]
});
const valveWires = Array.from({ length: 4 }, (_, index) => [
  ['rg-humidity-' + (index + 1)], ['rg-valve-' + (index + 1)]
]).flat();

const injection = (id, name, topic, y, repeat = '') => editorNode(id, 'inject', {
  name, topic, repeat, props: [{ p: 'topic', vt: 'str' }], once: Boolean(repeat),
  onceDelay: '0.3', crontab: '', x: 185, y, wires: [['rg-esp32']]
});
const entry = (id, name, method, route, topic, y) => [
  editorNode(id, 'http in', { name, method, url: route, upload: false, x: 185, y, wires: [[id + '-topic']] }),
  editorNode(id + '-topic', 'change', {
    name: 'Identificar ' + topic, rules: [{ t: 'set', p: 'topic', pt: 'msg', to: topic, tot: 'str' }],
    action: '', property: '', from: '', to: '', reg: false, x: 425, y, wires: [['rg-esp32']]
  })
];

const nodes = [
  { id: tab, type: 'tab', label: 'RiegoGuard Tacna', disabled: false, info: 'Simulación local con cuatro sectores de 100 m².' },
  editorNode('rg-notes', 'comment', {
    name: '1 · Entradas de control y telemetría',
    info: 'Abre /riegoguard/panel. Sus botones envían POST a /riegoguard/orden y reciben el estado actualizado. Un segundo equivale a un minuto virtual.',
    x: 250, y: 60, wires: []
  }),
  editorNode('rg-output-notes', 'comment', {
    name: '2 · Válvulas, panel y respuestas HTTP',
    info: 'El panel 2D/3D y los medidores comparten el estado. El POST ESP32 entrega lecturas y recibe la consigna de válvula.',
    x: 815, y: 60, wires: []
  }),
  injection('rg-clock', 'Reloj · 1 s = 1 min virtual', 'tick', 120, '1'),
  injection('rg-trigger-start', 'Iniciar riego', 'start', 165),
  injection('rg-trigger-stop', 'Detener riego', 'stop', 205),
  ...entry('rg-esp-http', 'POST · ESP32 / Wokwi', 'post', '/riegoguard/esp32', 'esp32', 300),
  ...entry('rg-health-http', 'GET · estado en vivo', 'get', '/riegoguard/estado', 'estado-http', 355),
  ...entry('rg-command-http', 'POST · órdenes del panel', 'post', '/riegoguard/orden', 'orden-http', 410),
  ...entry('rg-network-http', 'POST · parcelas Packet Tracer', 'post', '/riegoguard/red', 'red-http', 455),
  ...entry('rg-central-http', 'GET · datos centralizados', 'get', '/riegoguard/central', 'central-http', 500),
  ...entry('rg-network-status-http', 'POST · diagnóstico Packet Tracer', 'post', '/riegoguard/red/diagnostico', 'red-status-http', 535),
  editorNode('rg-panel-http', 'http in', {
    name: 'GET · panel 2D / 3D', method: 'get', url: '/riegoguard/panel', upload: false,
    x: 185, y: 570, wires: [['rg-panel-html']]
  }),
  editorNode('rg-panel-html', 'template', {
    name: 'HTML, CSS y simulación 3D', field: 'payload', fieldType: 'msg', format: 'html', syntax: 'plain',
    template: html, output: 'str', x: 445, y: 570, wires: [['rg-panel-response']]
  }),
  editorNode('rg-panel-response', 'http response', {
    name: 'Servir panel', statusCode: '200', headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    x: 705, y: 570, wires: []
  }),
  editorNode('rg-esp32', 'function', {
    name: 'Control de riego',
    initialize: model + '\n' + telemetry + '\ncontext.set("modelo", RiegoGuard);\ncontext.set("estado", RiegoGuard.create());'
      + '\ncontext.set("telemetria", Telemetria);\nlet datos = {};\ntry { datos = context.get("central", "historico") || {}; } catch {}\ncontext.set("central", datos);'
      + '\ncontext.set("bus", { boot: Date.now(), source: "wokwi", packet: null, packets: 0, connected: false, frame: 0, ticks: 0, actions: 0, action: null });',
    func: read('scripts/controlador-node-red.js').trim(),
    outputs: 3, outputLabels: ['Medidores nativos', 'Respuesta HTTP', 'Actividad del flujo'],
    x: 660, y: 205, wires: [['rg-metrics'], ['rg-http-response'], ['rg-debug']], libs: [], timeout: 0, noerr: 0
  }),
  editorNode('rg-http-response', 'http response', {
    name: 'Responder a panel y ESP32', statusCode: '', headers: {}, x: 935, y: 335, wires: []
  }),
  editorNode('rg-debug', 'debug', {
    name: 'Actividad del flujo', active: true, tosidebar: true, console: false, tostatus: false,
    complete: 'payload', targetType: 'msg', statusVal: '', statusType: 'auto', x: 915, y: 395, wires: []
  }),
  editorNode('rg-panel', 'ui-template', {
    group: 'rg-panel-group', name: 'Panel en FlowFuse', order: 1,
    width: 0, height: 1, format: panel, storeOutMessages: true, passthru: false,
    resendOnRefresh: true, templateScope: 'local', className: '',
    x: 940, y: 110, wires: [[]]
  }),
  editorNode('rg-metrics', 'function', {
    name: 'Distribuir lecturas por sector', outputs: 10, x: 945, y: 215, noerr: 0, libs: [],
    func: `
const { flow, pressure, sectors } = msg.payload;
const numero = (value) => value.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
return [
  { payload: numero(flow) + ' L/min' }, { payload: numero(pressure) + ' bar' },
  ...sectors.flatMap(({ moisture, open, valid }) => [{ payload: valid ? moisture : null }, { payload: valid ? open ? 'Abierta' : 'Cerrada' : 'Suelo sin lectura' }])
];`.trim(),
    outputLabels: ['Caudal', 'Presión', ...Array.from({ length: 4 }, (_, i) => ['S' + (i + 1) + ' humedad', 'S' + (i + 1) + ' válvula']).flat()],
    wires: [['rg-flow-text'], ['rg-pressure-text'], ...valveWires]
  }),
  {
    id: ui, type: 'ui-base', name: 'RiegoGuard Tacna', path: '/riego', appIcon: '', includeClientData: false,
    acceptsClientConfig: [], showPathInSidebar: false, headerContent: 'page', navigationStyle: 'default',
    titleBarStyle: 'default', showReconnectNotification: true, notificationDisplayTime: 1, showDisconnectNotification: true, allowInstall: false
  },
  {
    id: theme, type: 'ui-theme', name: 'RiegoGuard', colors: {
      surface: '#14372d', primary: '#24684f', bgPage: '#f4f6f3', groupBg: '#ffffff', groupOutline: '#dce5dd'
    }, sizes: { density: 'default', pagePadding: '14px', groupGap: '12px', groupBorderRadius: '10px', widgetGap: '10px' }
  },
  page('rg-panel-page', 'RiegoGuard Tacna', '/panel', 1, 'leaf'),
  page('rg-native-page', 'Medidores de la parcela', '/medidores', 2, 'gauge'),
  group('rg-panel-group', 'rg-panel-page', 'Panel', 1, 12, false),
  group('rg-pipe', 'rg-native-page', 'Conducción compartida', 1, 12)
];

function textWidget(id, groupId, label, name, order, y, width = 0) {
  return editorNode(id, 'ui-text', {
    group: groupId, name, label, order, width, height: 1, format: '{{msg.payload}}', layout: 'row-spread',
    style: false, wrapText: false, className: '', value: 'payload', valueType: 'msg', x: 1240, y, wires: []
  });
}

nodes.push(textWidget('rg-flow-text', 'rg-pipe', 'Caudal', 'Caudal de la conducción', 1, 100, 6));
nodes.push(textWidget('rg-pressure-text', 'rg-pipe', 'Presión', 'Presión de la conducción', 2, 140, 6));

for (let i = 1; i <= 4; i++) {
  const sectorGroup = 'rg-sector-' + i;
  nodes.push(group(sectorGroup, 'rg-native-page', 'S' + i + ' · 100 m²', i + 1, 6));
  nodes.push(editorNode('rg-humidity-' + i, 'ui-gauge', {
    group: sectorGroup, name: 'S' + i + ' · Humedad', order: 1, width: 0, height: 3,
    value: 'payload', valueType: 'msg', gtype: 'gauge-half', gstyle: 'needle',
    title: 'Humedad', alwaysShowTitle: true, floatingTitlePosition: 'top-left',
    units: 'Humedad del suelo', suffix: '%', icon: '', prefix: '', min: 0, max: 100,
    segments: [{ from: 0, color: '#d5a253' }, { from: 35, color: '#4a9b72' }, { from: 45, color: '#779aab' }],
    sizeThickness: 16, sizeGap: 4, sizeKeyThickness: 8, styleRounded: true, styleGlow: false, className: '',
    x: 1240, y: 100 + i * 80, wires: [[]]
  }));
  nodes.push(textWidget('rg-valve-' + i, sectorGroup, 'Válvula', 'S' + i + ' · Válvula', 2, 140 + i * 80));
}

fs.writeFileSync(path.join(root, 'flows.json'), JSON.stringify(nodes, null, 2) + '\n');
