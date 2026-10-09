import { ingressConfigurationIssue, type IngressEnvironment } from "./ingress";

/** Validate operator secrets without including their values in diagnostics. */
interface Configuration extends IngressEnvironment {
  HOSTED?: string;
  PUBLIC_URL?: string;
  ADMIN_TOKEN?: string;
  ENCRYPTION_KEY?: string;
}

function loopback(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}

function usableSecret(value: string | undefined): boolean {
  return typeof value === "string" && value.length >= 32 && value.trim() === value &&
    !/^(?:replace[-_ ]|change[-_ ]?me|your[-_ ])/i.test(value) && !/^(.)\1+$/.test(value);
}

export function configurationIssue(env: Configuration, requestUrl?: string): string | null {
  // A loopback PUBLIC_URL alone must not weaken a publicly reached deployment.
  if (loopback(env.PUBLIC_URL) && loopback(requestUrl)) return null;
  if (!usableSecret(env.ENCRYPTION_KEY)) return "Configure ENCRYPTION_KEY with a randomly generated secret of at least 32 characters.";
  if (env.HOSTED === "true") return ingressConfigurationIssue(env);
  if (!usableSecret(env.ADMIN_TOKEN)) return "Configure ADMIN_TOKEN with a randomly generated secret of at least 32 characters.";
  if (env.ADMIN_TOKEN === env.ENCRYPTION_KEY) return "Use different secrets for ADMIN_TOKEN and ENCRYPTION_KEY.";
  return null;
}
