/**
 * Hardcoded domain list for the DomainHealthWidget.
 * Edit this array before deployment to monitor your own services.
 * Each entry must be a full URL including scheme (http:// or https://).
 */
export const MONITORED_DOMAINS = [
  'https://example.com',
  'https://another.example.com',
  // Add your domains here, e.g.:
  // 'http://192.168.1.50:8080',
  // 'https://grafana.homelab.local',
] as const
