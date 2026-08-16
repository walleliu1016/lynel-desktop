/**
 * lynel-plugin build script (esbuild).
 *
 * Produces:
 *   lib/index.js   — host half (ESM, zero runtime deps; cordis/node types only)
 *   lib/client.js  — browser bundle in the DSH module-table handoff format:
 *                    `window.__ModuleLoader__.load({ id, factory(require) => exports })`
 *                    with react / react/jsx-runtime left to the table.
 *
 * Usage:  node scripts/build.mjs [--watch]
 */
import { build, context } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const banner = `/* lynel-plugin — built artifact, do not edit. */`;

function wrapClient() {
  const body = readFileSync(join(root, 'lib/_client-body.js'), 'utf8');
  const wrapped = `${banner}
window.__ModuleLoader__.load({
\tid: "lynel-plugin",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${body}
\t\treturn module.exports;
\t}
});
`;
  writeFileSync(join(root, 'lib/client.js'), wrapped);
  console.log('[build] lib/client.js wrapped');
}

const hostOptions = {
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(root, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  banner: { js: banner },
  logLevel: 'info',
};

const clientOptions = {
  entryPoints: [join(root, 'src/client/index.tsx')],
  outfile: join(root, 'lib/_client-body.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  logLevel: 'info',
};

mkdirSync(join(root, 'lib'), { recursive: true });

if (watch) {
  clientOptions.watch = {
    onRebuild: (error) => {
      if (!error) wrapClient();
    },
  };
  const hostCtx = await context(hostOptions);
  const clientCtx = await context(clientOptions);
  await hostCtx.watch();
  await clientCtx.watch();
  console.log('[build] watching src/ …');
} else {
  await build(hostOptions);
  await build(clientOptions);
  wrapClient();
}
