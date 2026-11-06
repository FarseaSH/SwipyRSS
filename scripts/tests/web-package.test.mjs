import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageDirectory, validateIdentity } from '../build-web-package.mjs';
const identity = { channel: 'test', version: '0.1.3-test.1', sourceCommit: 'a'.repeat(40), buildId: 'test-package-1' };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'swipyrss-package-'));
  const input = join(root, 'input');
  await mkdir(join(input, '.vite'), { recursive: true }); await mkdir(join(input, 'assets'));
  await writeFile(join(input, '.vite/manifest.json'), JSON.stringify({ index: { isEntry: true, file: 'assets/index.js' }, css: { file: 'assets/style.css' } }));
  await writeFile(join(input, 'assets/index.js'), 'console.log("reader")'); await writeFile(join(input, 'assets/style.css'), 'body{color:black}');
  for (const path of ['apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable.svg']) await writeFile(join(input, path), path);
  return { root, input, output: join(root, 'output') };
}
test('standalone ZIP contains only manifest and declared assets; digests match', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.input, 'extension.php'), '<?php echo "never";');
    await mkdir(join(f.input, '.pj')); await writeFile(join(f.input, '.pj/private.js'), 'secret');
    const result = await packageDirectory({ directory: f.input, output: f.output, identity });
    const names = spawnSync('unzip', ['-Z1', join(f.output, 'swipyrss.zip')], { encoding: 'utf8' }).stdout.trim().split('\n');
    assert.deepEqual(new Set(names), new Set(['build-manifest.json', ...result.manifest.files.map((f) => f.path)]));
    assert.ok(!names.some((p) => p.includes('.pj') || p.endsWith('.php')));
    const { createHash } = await import('node:crypto');
    assert.equal(result.latest.package.sha256, createHash('sha256').update(await readFile(join(f.output, 'swipyrss.zip'))).digest('hex'));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('missing assets, external CSS URLs, split JS, and symlinks are rejected', async (t) => {
  for (const kind of ['missing', 'css', 'split', 'symlink']) await t.test(kind, async () => {
    const f = await fixture();
    try {
      if (kind === 'missing') await rm(join(f.input, 'assets/index.js'));
      if (kind === 'css') await writeFile(join(f.input, 'assets/style.css'), 'body{background:url(../image.png)}');
      if (kind === 'split') await writeFile(join(f.input, '.vite/manifest.json'), JSON.stringify({ index: { isEntry: true, file: 'assets/index.js', dynamicImports: ['chunk'] } }));
      if (kind === 'symlink') await symlink(join(f.input, 'assets/index.js'), join(f.input, 'assets/linked.js'));
      await assert.rejects(packageDirectory({ directory: f.input, output: f.output, identity }));
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});
test('unsafe build IDs, wrong channels, and mutable/ambiguous source identities fail', () => {
  for (const fields of [{ buildId: '../escape' }, { channel: 'other' }, { sourceCommit: 'dev' }, { version: 'bad' }, { channel: 'stable', version: '0.1.3-rc.1' }]) assert.throws(() => validateIdentity({ ...identity, ...fields }));
});
