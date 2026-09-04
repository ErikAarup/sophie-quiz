// Build: client bundles (esbuild) + static pages into dist/public; the worker bundle into
// dist/worker (wrangler dry run); then assert that no secret ever made it into dist/.
//   node scripts/build.mjs           # everything (npm run build)
//   node scripts/build.mjs --client  # client only (fast; used by dev/e2e)
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientOnly = process.argv.includes('--client');
const distPublic = join(root, 'dist', 'public');
const distWorker = join(root, 'dist', 'worker');

// 1. Client bundles. Files are overwritten in place (never rm the directory: a running
//    `wrangler dev` holds it open on Windows).
mkdirSync(join(distPublic, 'assets'), { recursive: true });
await build({
  entryPoints: {
    player: join(root, 'src/client/player.ts'),
    admin: join(root, 'src/client/admin.ts'),
    qr: join(root, 'src/client/qr.ts'),
  },
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2020'],
  outdir: join(distPublic, 'assets'),
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
});
for (const file of ['index.html', 'admin.html', 'qr.html', 'styles.css']) {
  copyFileSync(join(root, 'public', file), join(distPublic, file));
}
console.log(`build: client -> dist/public (${readdirSync(join(distPublic, 'assets')).join(', ')})`);

// 2. Worker bundle (dry run: nothing is deployed)
if (!clientOnly) {
  rmSync(distWorker, { recursive: true, force: true });
  execSync(`npx wrangler deploy --dry-run --outdir "${distWorker}"`, { cwd: root, stdio: 'inherit' });
  console.log('build: worker -> dist/worker (dry run)');
}

// 3. Secret scan (WORK_ORDER §5): no ANTHROPIC / ADMIN_TOKEN string in the client bundle, and no
//    secret VALUE anywhere in dist/. The worker legitimately reads env.ANTHROPIC_API_KEY by name.
const secretValues = [];
const devVars = join(root, '.dev.vars');
if (existsSync(devVars)) {
  for (const line of readFileSync(devVars, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[2].trim().length >= 8) secretValues.push(m[2].trim().replace(/^["']|["']$/g, ''));
  }
}
const problems = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    const text = readFileSync(p, 'utf8');
    const rel = p.slice(root.length + 1);
    for (const v of secretValues) if (text.includes(v)) problems.push(`${rel}: contains a value from .dev.vars`);
    // Source maps embed the SDK's own sources, whose doc comments mention the key prefix; they are
    // never uploaded (no upload_source_maps) and are still checked for real values above.
    if (!name.endsWith('.map') && text.includes('sk-ant-')) problems.push(`${rel}: contains "sk-ant-"`);
    if (p.startsWith(distPublic)) {
      for (const needle of ['ANTHROPIC', 'ADMIN_TOKEN']) {
        if (text.includes(needle)) problems.push(`${rel}: contains "${needle}"`);
      }
    }
  }
}
walk(join(root, 'dist'));
if (problems.length) {
  console.error('build: SECRET SCAN FAILED');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`build: secret scan clean (${secretValues.length} .dev.vars value(s) checked, dist/ has no sk-ant-, client has no ANTHROPIC/ADMIN_TOKEN)`);
