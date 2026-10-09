const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

/** Time-sortable id (ULID layout, lowercase). */
export function ulid(ms = Date.now()): string {
  let t = ms;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let rand = "";
  for (const b of bytes) rand += CROCKFORD[b % 32];
  return time + rand;
}

export function randomToken(prefix: string, bytes = 24): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const b of raw) s += String.fromCharCode(b);
  return prefix + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison via hashing, so length and prefix don't leak. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

export const iso = (ms: number | null | undefined): string | null => (ms == null ? null : new Date(ms).toISOString());

export function parseJSON<T>(text: string | null | undefined, fallback: T): T {
  if (text == null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = cut.lastIndexOf(". ");
  return (sentence > max * 0.6 ? cut.slice(0, sentence + 1) : cut.trimEnd()) + " …";
}

export function isHttpsUrl(value: unknown, allowLocal = false): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    if (u.protocol === "https:") return true;
    return allowLocal && u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

/** Short relative time for humans, e.g. "in 44 min" or "3 min ago". */
export function relative(ms: number, from = Date.now()): string {
  const diff = Math.round((ms - from) / 60000);
  const abs = Math.abs(diff);
  const text = abs < 1 ? "under a minute" : abs < 90 ? `${abs} min` : `${Math.round(abs / 60)} h`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}
