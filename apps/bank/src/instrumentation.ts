/**
 * Next.js calls `register()` exactly once when a new server process boots —
 * in dev, in `next start`, and in the standalone server produced by
 * `output: "standalone"` (Task 5/13's Dockerfile CMD `node server.js`).
 *
 * Without this file, nothing in the app is imported until the first request
 * hits a route that needs it. Next's route handlers are loaded lazily per
 * request, so `env.ts`'s "validate at module load, crash with a named error"
 * design (Task 5) only ever fired on whichever route happened to be hit
 * first — `/api/health` never imports it, so a container with a missing
 * `SESSION_SECRET` reported "running" and passed liveness checks
 * indefinitely, only 500ing once something called `/api/ready` or any
 * DB-touching route. Found while verifying Task 13's Dockerfile against a
 * real podman container: the process stayed up for the full test with
 * `SESSION_SECRET` unset.
 *
 * Location matters: Next.js computes the instrumentation-hook root as
 * `path.join(appDir, "..")`. This app uses the `src/app` layout, so that
 * root is `src/`, not the package root — this file must live at
 * `src/instrumentation.ts`, not `apps/bank/instrumentation.ts` (where it was
 * first placed and silently ignored, with no build warning).
 *
 * Explicit process.exit(1) matters too, verified with two different builds
 * against a real podman container. A first version left the import
 * unguarded (let it throw). That version did NOT crash: the container kept
 * running, printed "Ready", and every request — including /api/health —
 * permanently returned 500 without the process ever exiting (Next's
 * request-handling call site catches the rejection and just keeps retrying
 * per request, since its internal `prepared` flag never flips to true). That
 * IS a real improvement over having no instrumentation hook at all
 * (previously /api/health returned 200 forever, hiding the misconfiguration
 * from a liveness probe completely) — but it's not the hard "crash at boot"
 * signal the deployment contract documents, and it means the plan's
 * original Step 4 verification ("run the container and expect it to exit on
 * its own") never terminated either. Calling process.exit(1) ourselves,
 * from inside a try/catch instead of letting the error propagate, fixed
 * this completely: the container now exits (exitcode 1, this message in its
 * logs, no "Ready" line ever printed) within a few seconds of `podman run`,
 * with no request sent at all.
 */
export async function register() {
  try {
    await import("./env.js");
  } catch (error) {
    console.error(
      "[bank] Fatal: invalid environment configuration — refusing to serve requests.",
      error,
    );
    process.exit(1);
  }
}