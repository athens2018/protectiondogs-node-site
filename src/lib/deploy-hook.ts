// Best-effort rebuild trigger after a CMS save. Neither a Vercel Deploy
// Hook (needs the pending GitHub connection) nor a VERCEL_API_TOKEN
// (creating one from here was blocked by this environment's own
// safeguard) exist yet, so this reads DEPLOY_HOOK_URL and POSTs to it if
// set. Deliberately never throws and never blocks/fails the content save
// that calls it — saving the dog data is the one thing that must always
// work regardless of deploy-wiring state (see the brief's Publish flow).
export type DeployTriggerResult = 'skipped' | 'triggered' | 'failed';

export async function triggerDeploy(): Promise<DeployTriggerResult> {
  const url = process.env.DEPLOY_HOOK_URL;
  if (!url) return 'skipped';
  try {
    const res = await fetch(url, { method: 'POST' });
    return res.ok ? 'triggered' : 'failed';
  } catch (err) {
    console.error('[deploy-hook] request failed:', err instanceof Error ? err.message : String(err));
    return 'failed';
  }
}
