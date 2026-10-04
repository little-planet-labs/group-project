const API = 'https://api.github.com';

// GitHub App JWT (RS256). iat is backdated 60s for clock drift; exp is 9 minutes out,
// inside GitHub's 10-minute maximum.
export async function signAppJwt(
  appId: string,
  pkcs8Pem: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const der = Uint8Array.from(
    atob(pkcs8Pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 9 * 60, iss: appId }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Errors carry only the method, path and status: never headers or tokens.
export class GitHubError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// A GitHub REST call. Every call aborts at `deadline` (epoch ms), so a screening can never
// outlive Workers' 30s waitUntil budget because of a slow GitHub.
export type GitHub = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;

export function gitHubClient(authorization: string, deadline: number): GitHub {
  return async (method, path, body) => {
    const res = await fetch(API + path, {
      method,
      headers: {
        authorization,
        accept: 'application/vnd.github+json',
        'user-agent': 'groupproject-screener',
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(0, deadline - Date.now())),
    });
    if (!res.ok) throw new GitHubError(`GitHub ${method} ${path} failed: ${res.status}`, res.status);
    return (res.status === 204 ? undefined : await res.json()) as never;
  };
}

export async function installationToken(
  appId: string,
  privateKey: string,
  installationId: number,
  deadline: number,
): Promise<string> {
  const app = gitHubClient(`Bearer ${await signAppJwt(appId, privateKey)}`, deadline);
  const { token } = await app<{ token: string }>(
    'POST',
    `/app/installations/${installationId}/access_tokens`,
  );
  return token;
}

export interface PullFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

// The files changed by exactly `head` (an immutable SHA) since its merge base with `base`.
// `pulls/:n/files` is not used: it follows whatever the PR's head is at read time.
// GitHub's compare API lists files only on the first page and at most 300 for the whole
// comparison, without saying whether it truncated, so a listing that reaches the limit fails.
export const COMPARE_FILE_LIMIT = 300;

export async function listCommitFiles(gh: GitHub, repo: string, base: string, head: string): Promise<PullFile[]> {
  const { files = [] } = await gh<{ files?: PullFile[] }>(
    'GET',
    `/repos/${repo}/compare/${base}...${head}?per_page=1`,
  );
  if (files.length >= COMPARE_FILE_LIMIT) {
    throw new Error(`compare listed ${files.length} files; the listing may be truncated`);
  }
  return files;
}
