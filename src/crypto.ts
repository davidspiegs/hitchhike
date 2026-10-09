/**
 * Agent keys are stored twice: hashed (to authenticate) and encrypted (so the
 * owner can reopen an agent's setup instructions later). The encryption key is
 * derived from a server-side encryption secret, never stored in the database.
 * Legacy self-hosted deployments can still use their owner token as the secret.
 */

const enc = new TextEncoder();

async function cipherKey(ownerToken: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(ownerToken), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("agent-connector/agent-keys"), info: enc.encode("v1") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Encrypts an agent key, bound to that agent's id so ciphertexts can't be swapped between agents. */
export async function sealAgentKey(ownerToken: string, agentId: string, key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(agentId) },
    await cipherKey(ownerToken),
    enc.encode(key),
  );
  const out = new Uint8Array(iv.length + sealed.byteLength);
  out.set(iv);
  out.set(new Uint8Array(sealed), iv.length);
  return "v1:" + toB64(out);
}

/** Returns null if the ciphertext is missing or the owner token has changed since it was sealed. */
export async function openAgentKey(ownerToken: string, agentId: string, sealed: string | null, previousKey?: string): Promise<string | null> {
  if (!sealed) return null;
  try {
    const bytes = fromB64(sealed.startsWith("v1:") ? sealed.slice(3) : sealed);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: enc.encode(agentId) },
      await cipherKey(ownerToken),
      bytes.slice(12),
    );
    return new TextDecoder().decode(plain);
  } catch {
    if (previousKey && previousKey !== ownerToken) return openAgentKey(previousKey, agentId, sealed);
    return null;
  }
}
