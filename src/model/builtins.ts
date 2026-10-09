/**
 * Pipelines Cribl ships in every new group (defaults and samples); unused copies are expected,
 * not clutter. Confirmed against a fresh Cribl.Cloud 4.20 workspace (workspace-clean fixture).
 */
export const BUILTIN_PIPELINES = new Set([
  'passthru',
  'main',
  'devnull',
  'cribl_metrics_rollup',
  'prometheus_metrics',
  'cisco_asa',
  'cisco_estreamer',
  'palo_alto_traffic',
  'wineventlogs',
  // Shipped with Edge Fleets.
  'kubernetes_logs',
]);
