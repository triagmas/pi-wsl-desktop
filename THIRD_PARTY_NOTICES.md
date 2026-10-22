# Third-Party Notices

Pi WSL Desktop bundles the following third-party production dependencies.
All of them are already inlined into the application bundles by esbuild/Vite
at build time; the Windows installer ships no `node_modules` of its own.

| Component | Version (range) | License | Project |
|---|---|---|---|
| react | ^19.3.1 | MIT | https://github.com/facebook/react |
| react-dom | ^19.3.1 | MIT | https://github.com/facebook/react |
| zod | ^4.6.7 | MIT | https://github.com/colinhacks/zod |

The Electron runtime itself is licensed under the MIT License with additional
redistribution terms — see https://github.com/electron/electron/blob/main/LICENSE.

Build-time-only tooling (esbuild, Vite, Vitest, TypeScript, electron-builder,
Playwright and their transitive dependencies) is NOT shipped inside the
installer and is therefore listed only in `package-lock.json`.

This application uses the user's own existing Pi agent installation inside
WSL; no copy of Pi, its models, sessions or configuration is bundled,
installed, modified or removed by this installer.
