'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { experiment, csv } = require('../app/simulador');
const output = path.join(__dirname, '..', 'evidencias');
const results = experiment();

fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'resultados-E4.csv'), '\uFEFF' + csv(results));
fs.writeFileSync(path.join(output, 'resultados-E4.json'), JSON.stringify(results, null, 2) + '\n');
console.table(results.map(({ label, liters, intensity, band }) => ({
  Estrategia: label, 'Litros totales': liters, 'L/m²/día': intensity.toFixed(2), 'En banda (%)': band.toFixed(2)
})));
