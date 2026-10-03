import { describe, expect, it } from 'vitest';
import { signAppJwt } from '../src/github.ts';
import { rsaKeyPair } from './helpers.ts';

function decode(part: string) {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

describe('github app jwt', () => {
  it('jwt_is_rs256_and_verifies_with_public_key', async () => {
    const { privatePem, publicKey } = await rsaKeyPair();
    const now = 1_800_000_000;
    const jwt = await signAppJwt('12345', privatePem, now);
    const [header, claims, signature] = jwt.split('.');

    expect(JSON.parse(new TextDecoder().decode(decode(header)))).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(new TextDecoder().decode(decode(claims)))).toEqual({ iat: now - 60, exp: now + 540, iss: '12345' });
    expect(jwt).not.toMatch(/[+/=]/);

    const input = new TextEncoder().encode(`${header}.${claims}`);
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decode(signature), input)).toBe(true);
    const tampered = new TextEncoder().encode(`${header}.${claims}x`);
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decode(signature), tampered)).toBe(false);
  });
});
