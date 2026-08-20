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
  // Next compiles this file for the edge runtime too (see next.config.ts),
  // where the db imports below are deliberately replaced with empty stubs and
  // no route ever runs. Bail out before touching them. The test is positive —
  // `=== "edge"`, not `!== "nodejs"` — so an unset NEXT_RUNTIME still
  // validates env and seeds rather than silently skipping both.
  if (process.env.NEXT_RUNTIME === "edge") return;

  try {
    await import("./env.js");
  } catch (error) {
    console.error(
      "[merchant] Fatal: invalid environment configuration — refusing to serve requests.",
      error,
    );
    process.exit(1);
  }

  // Seed a fresh deployment so the shop has a catalogue. Both imports must stay
  // dynamic and inside this function: a static top-level import of
  // ./db/index.js would transitively evaluate ./env.js at module load, before
  // the try/catch above, undoing the fix this file's header describes.
  try {
    const { getDb } = await import("./db/index.js");
    const { seedIfEmpty } = await import("./db/seed.js");
    const seeded = seedIfEmpty(getDb());
    console.log(
      seeded
        ? "[merchant] Seeded an empty catalogue with the demo products."
        : "[merchant] Catalogue already populated — left untouched.",
    );
  } catch (error) {
    console.error(
      "[merchant] Fatal: could not open or seed the database — refusing to serve requests.",
      error,
    );
    process.exit(1);
  }
}