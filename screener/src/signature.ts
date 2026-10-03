// Verifies GitHub's X-Hub-Signature-256 header: "sha256=" + hex HMAC-SHA256 of the raw body.
// The HMAC is computed over the exact bytes received; re-serialised JSON would not match.
export async function verifySignature(
  secret: string,
  body: ArrayBuffer,
  header: string | null,
): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false;
  const expected = hexToBytes(header.slice('sha256='.length));
  if (!expected) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const actual = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
  return constantTimeEqual(actual, expected);
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// Both arrays are 32 bytes here, so only the contents are compared, without early exit.
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
