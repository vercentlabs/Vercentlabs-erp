import { ApiClient } from '@vercentlabs/api-client';
import { webEnv } from '../lib/env.js';
import { getApiStatus } from '../lib/get-api-status.js';

// This page's entire purpose is a live status check. Without this, Next
// would statically prerender it once at build time (API almost certainly
// not running then) and freeze that snapshot for every later request.
export const dynamic = 'force-dynamic';

export default async function FoundationPage() {
  const client = new ApiClient({ baseUrl: webEnv.NEXT_PUBLIC_API_BASE_URL });
  const apiStatus = await getApiStatus(client);

  return (
    <main>
      <h1>Vercentlabs ERP — Engineering Foundation</h1>
      <p>
        This page confirms the platform foundation established by Prompt 1 is running. No business
        modules are implemented yet; see <code>product/registers/shared-platform.yaml</code> for the
        status of every shared-platform capability.
      </p>
      <div role="status" aria-live="polite">
        <dl>
          <dt>apps/web</dt>
          <dd>running</dd>
          <dt>apps/api liveness</dt>
          <dd>{apiStatus}</dd>
        </dl>
      </div>
      {apiStatus === 'unreachable' && (
        <p role="alert">
          apps/api did not respond. Start it (<code>pnpm --filter @vercentlabs/api dev</code>) and
          reload this page.
        </p>
      )}
    </main>
  );
}
