import { screenPullRequest, shouldScreen, type Env, type PullRequestEvent } from './screen.ts';
import { verifySignature } from './signature.ts';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') return new Response(null, { status: 405 });

    const body = await request.arrayBuffer();
    const signature = request.headers.get('x-hub-signature-256');
    if (!(await verifySignature(env.GITHUB_WEBHOOK_SECRET, body, signature))) {
      return new Response(null, { status: 401 });
    }

    const payload = JSON.parse(new TextDecoder().decode(body)) as PullRequestEvent;
    if (!shouldScreen(request.headers.get('x-github-event'), payload)) {
      return new Response(null, { status: 200 });
    }

    // GitHub times webhooks out after 10s, so acknowledge now and screen in the background.
    // waitUntil allows 30s after the response; Jev calls time out at 15s to leave room
    // for an error check run.
    ctx.waitUntil(screenPullRequest(env, payload));
    return new Response(null, { status: 202 });
  },
} satisfies ExportedHandler<Env>;
