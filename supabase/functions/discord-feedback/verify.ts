// Ed25519 signature verification for Discord interactions.
import nacl from "https://esm.sh/tweetnacl@1.0.3";

function hexToUint8(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * Verify a Discord interaction request signature.
 * Returns true when the signature is valid for the given body.
 */
export function verifyDiscordSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  publicKeyHex: string,
): boolean {
  if (!signature || !timestamp) return false;
  try {
    const message = new TextEncoder().encode(timestamp + rawBody);
    const sig = hexToUint8(signature);
    const key = hexToUint8(publicKeyHex);
    if (sig.length !== 64 || key.length !== 32) return false;
    return nacl.sign.detached.verify(message, sig, key);
  } catch (_e) {
    return false;
  }
}
