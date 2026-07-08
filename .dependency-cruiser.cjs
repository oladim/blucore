/**
 * ARCHITECTURAL FIREWALL — enforced in CI.
 * The canonical core must never know about specific networks,
 * transport layers, or (future) PMS connectors.
 */
module.exports = {
  forbidden: [
    {
      name: 'core-must-not-import-networks',
      severity: 'error',
      from: { path: '^src/(core|canonical)' },
      to: { path: '^src/networks/(?!network.interface|network.registry)' },
    },
    {
      name: 'canonical-imports-nothing',
      severity: 'error',
      from: { path: '^src/canonical' },
      to: { path: '^src/(core|networks|tenancy|queues|config)' },
    },
  ],
  options: { tsConfig: { fileName: 'tsconfig.json' } },
};
