/**
 * Hardcoded domain list for the DomainHealthWidget.
 * Edit this array before deployment to monitor your own services.
 * Each entry must be a full URL including scheme (http:// or https://).
 */
export const MONITORED_DOMAINS = [
  "https://timur.aboard.ru",
  "https://timur.aboard.ru/collabra",
  "https://timur.aboard.ru/collabra/api",
  "https://timur.aboard.ru/casinoapp",
  "https://timur.aboard.ru/casinoapp/api",
  "https://timur.aboard.ru/casinoapp/admin",
  "https://timur.aboard.ru/grocket",
  "https://timur.aboard.ru/grocket/api",
  "https://ramz1.vercel.app",
  // Add your domains here, e.g.:
  // 'http://192.168.1.50:8080',
  // 'https://grafana.homelab.local',
] as const;
