'use strict';

module.exports = {
  uiHost: '0.0.0.0',
  uiPort: Number(process.env.PORT) || 1880,
  flowFile: 'flows.json',
  flowFilePretty: true,
  contextStorage: {
    default: { module: 'memory' },
    historico: { module: 'localfilesystem', config: { flushInterval: 15 } }
  },
  editorTheme: { projects: { enabled: false } }
};
