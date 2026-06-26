# End-to-end layout tests

Playwright tests that verify the safe-area layout invariants (login screen does
not scroll / show a white bar; app content does not overflow under the device
nav bar), using a mobile viewport and simulated safe-area insets.

## Running

```bash
npm run test:e2e
```

### Local note (Windows / MSYS2)

On this machine Vite's dev server can hit a transient transform race while
pre-bundling the large `converse.js` headless dependency **when the server is
spawned by Playwright's `webServer`**. The same `npm run dev` warms up fine when
started from a normal shell. The reliable local invocation is therefore:

```bash
# terminal 1
npm run dev

# terminal 2 (Playwright reuses the running server)
npm run test:e2e
```

`reuseExistingServer` is enabled (outside CI), so a dev server you start
yourself is reused. `globalSetup` warms the server with a real browser load
before the suite runs. On CI (Linux) the auto-spawned `webServer` works without
a separately-started server.

## Logged-in overflow test

`e2e/layout.spec.ts` includes an authenticated app-shell overflow test that is
skipped unless real credentials are provided:

```bash
XMPP_TEST_JID=you@example.com XMPP_TEST_PASSWORD=secret npm run test:e2e
```
