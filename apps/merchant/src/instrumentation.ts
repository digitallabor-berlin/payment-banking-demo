/**
 * Next.js calls `register()` once per server process boot. Without this file,
 * nothing in the app is imported until some route needs it, so env.ts's
 * "validate at import time" design silently never fires for a container whose
 * first-hit route doesn't happen to need it (e.g. /api/health). A bare throw
 * here is not reliably fatal either — depending on which internal Next.js
 * call site ends up invoking this hook, an uncaught throw can degrade to
 * "every route permanently 500s" without the process ever exiting, which is a
 * far weaker signal for an orchestrator than a hard crash. Both findings are
 * from Plan 1 Task 13, verified against a real podman container.
 */
export async function register() {
  try {
    await import("./env.js");
  } catch (error) {
    console.error(
      "[merchant] Fatal: invalid environment configuration — refusing to serve requests.",
      error,
    );
    process.exit(1);
  }
}