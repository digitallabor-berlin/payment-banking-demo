# cdp.mjs — minimal headless-Chrome driver

A ~100-line Chrome DevTools Protocol client used only for manual verification
of browser-interaction steps in the implementation plans (Plan 1 had none
available and had to skip its browser checklists; Plan 2 uses this for Tasks
4, 5, 9, and 10).

Not part of the app, not a test runner, not wired into `pnpm test` — it is a
throwaway-script helper, invoked ad hoc from a scratch `.mjs` file during
plan execution, the same way `scratch.ts` is used for one-off DB pokes (see
Plan 2's Global Constraints).

## Usage

```js
import { withPage } from "../../tools/cdp/cdp.mjs";

await withPage(async (page) => {
  await page.goto("http://localhost:3000/");
  const count = await page.eval(`return document.querySelectorAll('button').length;`);
  console.log(count);
});
```

Requires a local Google Chrome install at the hardcoded macOS path
(`/Applications/Google Chrome.app/...`). No Playwright/Puppeteer dependency —
deliberately, to avoid adding a devDependency to every app just for ad hoc
verification scripts that are not part of the test suite.