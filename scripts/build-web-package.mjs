import { cp, mkdir, readFile, readdir, rm, lstat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowed = /\.(js|css|png|svg|jpg|jpeg|gif)$/;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr || ''}`);
  return result.stdout?.trim();
}
export function validateIdentity({ channel, version, sourceCommit, buildId }) {
  if (!['stable', 'prerelease', 'test'].includes(channel)) throw new Error('Invalid channel');
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error('A full source commit SHA is required');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,119}$/.test(buildId)) throw new Error('Invalid build ID');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid version');
  if (channel === 'stable' && version.includes('-')) throw new Error('Stable version cannot be a prerelease');
}

/** Package an existing Vite output using an explicit static-file allowlist. */
export async function packageDirectory({ directory, output, identity, createdAt = new Date().toISOString() }) {
  validateIdentity(identity);
  const vite = JSON.parse(await readFile(join(directory, '.vite/manifest.json'), 'utf8'));
  const entries = Object.values(vite).filter((item) => item.isEntry);
  if (entries.length !== 1 || entries[0].imports?.length || entries[0].dynamicImports?.length) throw new Error('Expected one self-contained JavaScript entry');
  const css = [...new Set([...(entries[0].css || []), ...Object.values(vite).map((item) => item.file).filter((path) => path.endsWith('.css'))])];
  const stage = join(output, 'stage');
  await rm(output, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  const files = [];
  async function collect(folder) {
    for (const item of (await readdir(folder)).sort()) {
      if (item.startsWith('.')) continue;
      const source = join(folder, item);
      const info = await lstat(source);
      if (info.isSymbolicLink()) throw new Error('Symlinks are not allowed in frontend packages');
      if (info.isDirectory()) { await collect(source); continue; }
      const path = relative(directory, source).replaceAll('\\', '/');
      if (!allowed.test(path)) continue;
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(path) || path.includes('..')) throw new Error(`Unsafe asset path: ${path}`);
      const bytes = await readFile(source);
      if (bytes.length > 10 * 1024 * 1024) throw new Error(`Asset exceeds 10 MB: ${path}`);
      if (path.endsWith('.css') && /url\(\s*["']?(?!data:|#)/i.test(bytes.toString())) throw new Error(`CSS cannot contain external URLs: ${path}`);
      await mkdir(dirname(join(stage, path)), { recursive: true });
      await cp(source, join(stage, path));
      files.push({ path, size: bytes.length, sha256: digest(bytes) });
    }
  }
  await collect(directory);
  const paths = new Set(files.map((file) => file.path));
  const icons = { 'apple-touch-icon': 'apple-touch-icon.png', 'pwa-192x192': 'pwa-192x192.png', 'pwa-512x512': 'pwa-512x512.png', 'pwa-maskable': 'pwa-maskable.svg' };
  if (!entries[0].file.endsWith('.js') || !paths.has(entries[0].file) || css.some((path) => !paths.has(path)) || Object.values(icons).some((path) => !paths.has(path))) throw new Error('Required entry or icon is missing');
  if (files.length > 500 || files.reduce((n, file) => n + file.size, 0) > 50 * 1024 * 1024) throw new Error('Frontend package exceeds size/count limits');
  const manifest = { schema: 1, ...identity, createdAt, minExtensionVersion: '0.1.0', hostProtocol: 1, storageSchema: 1, entry: { js: entries[0].file, css }, icons, files };
  await writeFile(join(stage, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const zipPath = join(output, 'swipyrss.zip');
  run('zip', ['-q', '-X', zipPath, 'build-manifest.json', ...files.map((file) => file.path)], { cwd: stage });
  const zip = await readFile(zipPath);
  if (zip.length > 20 * 1024 * 1024) throw new Error('ZIP exceeds 20 MB');
  const latest = { schema: 1, ...identity, createdAt, package: { file: 'swipyrss.zip', size: zip.length, sha256: digest(zip) } };
  await writeFile(join(output, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
  await rm(stage, { recursive: true, force: true });
  return { manifest, latest, output };
}

export async function buildPackage(options = {}) {
  const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
  const channel = options.channel || 'test';
  const sourceCommit = options.sourceCommit || run('git', ['rev-parse', 'HEAD']);
  if (sourceCommit !== run('git', ['rev-parse', 'HEAD'])) throw new Error('Source SHA does not match the checked-out commit');
  const sourceDirty = Boolean(run('git', ['status', '--porcelain', '--untracked-files=normal']));
  if (process.env.GITHUB_ACTIONS === 'true' && sourceDirty) throw new Error('CI source checkout must be clean');
  const runId = options.runId || `${Date.now()}`;
  const buildId = options.buildId || `${channel}-${sourceCommit.slice(0, 12)}-${runId}`;
  const version = options.version || (channel === 'stable' ? packageJson.version : `${packageJson.version}-${channel}.${runId}`);
  const identity = { channel, version, sourceCommit, buildId, sourceDirty };
  validateIdentity(identity);
  const directory = join(repositoryRoot, '.build', `web-${channel}`);
  run(join(repositoryRoot, 'node_modules/.bin/tsc'), ['-b'], { stdio: 'inherit' });
  run(join(repositoryRoot, 'node_modules/.bin/vite'), ['build', '--mode', 'extension', '--outDir', directory], {
    stdio: 'inherit', env: { ...process.env, VITE_SWIPY_BUILD_ID: buildId, VITE_SWIPY_VERSION: version, VITE_SWIPY_CHANNEL: channel },
  });
  return packageDirectory({ directory, output: join(repositoryRoot, 'release', channel), identity });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  const names = { '--channel': 'channel', '--version': 'version', '--build-id': 'buildId', '--source-commit': 'sourceCommit', '--run-id': 'runId' };
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = names[process.argv[i]];
    if (!key || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new Error(`Invalid argument: ${process.argv[i]}`);
    options[key] = process.argv[i + 1];
  }
  const result = await buildPackage(options);
  console.log(`Frontend package: ${relative(repositoryRoot, result.output)}`);
  console.log(`Build: ${result.latest.buildId} (${result.latest.sourceCommit})`);
}
