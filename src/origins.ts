export interface OriginEnv { PUBLIC_URL?: string; FRONTEND_URL?: string }

export class OriginConfigurationError extends Error {}

function configuredOrigin(value: string | undefined, label: string): string {
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && local))) throw new Error();
    return url.origin;
  } catch { throw new OriginConfigurationError(`Configure ${label} as an HTTPS origin (or a loopback HTTP origin for local development).`); }
}

export function deploymentOrigins(env: OriginEnv, requestOrigin?: string): { apiOrigin: string; frontendOrigin: string; split: boolean } {
  const apiOrigin = configuredOrigin(env.PUBLIC_URL || requestOrigin, "PUBLIC_URL");
  const frontendOrigin = configuredOrigin(env.FRONTEND_URL || apiOrigin, "FRONTEND_URL");
  return { apiOrigin, frontendOrigin, split: frontendOrigin !== apiOrigin };
}
