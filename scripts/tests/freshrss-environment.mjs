import { cp, mkdir, access, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const work = join(root, '.build/freshrss-extension');
export const app = join(work, 'freshrss');
export const extension = join(app, 'extensions/xExtension-SwipyRSS');
export const php = process.env.SWIPY_PHP || join(root, '.pj/FreshRSS/runtime/php');
export const origin = process.env.SWIPY_SERVER_ORIGIN || 'http://localhost:8099';
export const username = 'validation';
export const password = 'local-validation-only';
export async function exists(path) { try { await access(path); return true; } catch { return false; } }
export function runPhp(args) {
  const result = spawnSync(php, args, { cwd: app, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr + '\n' + result.stdout);
  return result.stdout;
}
export async function setup() {
  await access(php);
  if (!(await exists(join(app, 'constants.php')))) {
    const source = process.env.SWIPY_FRESHRSS_SOURCE || join(root, '.pj/FreshRSS/app');
    await cp(source, app, { recursive: true, filter: (path) => {
      const relative = path.slice(source.length).replaceAll('\\', '/');
      return !['/data', '/extensions', '/.git', '/constants.local.php'].some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
    } });
  }
  for (const folder of ['data/users/_', 'data/cache', 'data/tokens', 'data/extensions-data', 'data/favicons', 'data/fever', 'data/PubSubHubbub', 'extensions']) await mkdir(join(app, folder), { recursive: true });
  const source = join(root, 'xExtension-SwipyRSS');
  await cp(source, extension, { recursive: true, filter: (path) => {
    const relative = path.slice(source.length).replaceAll('\\', '/');
    return !['/.git', '/storage', '/imports', '/static/versions'].some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
  } });
  if (!(await exists(join(app, 'data/applied_migrations.txt')))) {
    await writeFile(join(app, 'data/config.custom.php'), "<?php return ['extensions_enabled'=>['SwipyRSS'=>true]];\n");
    runPhp(['cli/do-install.php', `--default-user=${username}`, '--auth-type=form', '--environment=development', `--base-url=${origin}`, '--language=zh-CN', '--title=SwipyRSS Extension 测试', '--api-enabled', '--disable-update', '--db-type=sqlite']);
    runPhp(['cli/create-user.php', `--user=${username}`, `--password=${password}`, `--api-password=${password}`, '--language=zh-CN', '--no-default-feeds']);
    runPhp(['cli/create-user.php', '--user=reader', `--password=${password}`, `--api-password=${password}`, '--language=zh-CN', '--no-default-feeds']);
  }
  async function lint(directory) {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, file.name);
      if (file.isDirectory() && !['storage', 'imports', 'versions'].includes(file.name)) await lint(path);
      else if (/\.(php|phtml)$/.test(file.name)) runPhp(['-l', path]);
    }
  }
  await lint(extension);
}
export function install(path) {
  return JSON.parse(runPhp(['-r', `require ${JSON.stringify(join(extension, 'lib/Packages.php'))}; $p=new SwipyRSS_Packages(${JSON.stringify(extension)}); echo json_encode($p->install(${JSON.stringify(path)}));`]));
}
export function setMode(mode) {
  if (!['auto', 'direct', 'enhanced'].includes(mode)) throw new Error('Invalid test mode');
  runPhp(['-r', `$path=${JSON.stringify(join(app, 'data/config.php'))};$c=include $path;$c['extensions']['SwipyRSS']['runtime_mode']=${JSON.stringify(mode)};file_put_contents($path,"<?php return ".var_export($c,true).";\n");`]);
}
