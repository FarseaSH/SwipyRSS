import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rename, rm, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { setup, php, app, origin, root, work, extension, install, setMode, username, password } from './freshrss-environment.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SWIPY_PLAYWRIGHT || 'playwright');
await setup();
await rm(join(extension, 'storage/versions.json'), { force: true });
await rm(join(extension, 'static/versions'), { recursive: true, force: true });
setMode('auto');
install(join(root, '.build/package-fixtures/stable-a.zip'));
const log = await open(join(work, 'server.log'), 'w');
const server = spawn(php, ['-S', `localhost:${new URL(origin).port}`, '-t', join(app, 'p')], { cwd: app, stdio: ['ignore', log.fd, log.fd] });
const results = [];
const record = (name) => { results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); };
const appUrl = `${origin}/i/?c=swipyrss`;
const configUrl = `${origin}/i/?c=extension&a=configure&e=SwipyRSS`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitBuild = (page, id, mode) => page.waitForFunction(({ id, mode }) => {
  const state = window.swipyHost?.getState(); return state?.buildId === id && (!mode || state.mode === mode);
}, { id, mode }, { timeout: 30000 });
const screenshot = async (page, name) => page.screenshot({ path: join(work, name + '.png') });
let browser;
let context;
async function credential(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve) => { const request = indexedDB.open('swipyrss'); request.onsuccess = () => resolve(request.result); });
    const value = await new Promise((resolve) => { const request = db.transaction('credentials').objectStore('credentials').getAll(); request.onsuccess = () => resolve(request.result); });
    db.close(); return value;
  });
}
async function nativeLogin(page, user) {
  await page.goto(`${origin}/i/?c=auth&a=login`);
  await page.locator('#username').fill(user); await page.locator('#passwordPlain').fill(password);
  await page.locator('#loginButton').click();
  await page.waitForFunction(() => !document.querySelector('#passwordPlain'));
}
try {
  let ready = false;
  for (let n = 0; n < 80; n++) {
    if (server.exitCode !== null) throw new Error('PHP server exited; inspect server.log');
    try { if ((await fetch(appUrl)).ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  assert.ok(ready);
  browser = await chromium.launch({ headless: true, timeout: 20000,
    executablePath: process.env.SWIPY_BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--host-resolver-rules=MAP swipyrss.test 127.0.0.1', '--no-proxy-server'] });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Keep integration tests deterministic and offline with respect to GitHub.
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('c') === 'swipyrss' && url.searchParams.get('a') === 'check') return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"message":"test: upstream check skipped"}' });
    return route.continue();
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(appUrl);
  await waitBuild(page, 'stable-a', 'enhanced');
  assert.equal(await page.locator('#root').getAttribute('data-username'), '');
  record('FreshRSS standard extension boots enhanced A with public shell');
  await page.getByPlaceholder('FreshRSS 用户名', { exact: true }).fill(username);
  await page.getByPlaceholder('FreshRSS API 密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '连接并进入', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('input[type=password]'));
  const auth = await credential(page); assert.ok(auth.length);
  record('Real gReader authentication and article initialization');
  await screenshot(page, '01-enhanced-a');
  install(join(root, '.build/package-fixtures/stable-b.zip'));
  await page.evaluate(() => window.swipyHost.check());
  await page.getByRole('button', { name: '更新', exact: true }).waitFor();
  await page.reload(); await waitBuild(page, 'stable-a', 'enhanced');
  record('Publishing B does not replace selected A');
  const second = await context.newPage(); await second.goto(appUrl); await waitBuild(second, 'stable-a');
  const state = await (await fetch(`${appUrl}&a=runtime`)).json();
  const b = state.builds.find((build) => build.buildId === 'stable-b');
  const broken = join(extension, 'static/versions/stable/stable-b', b.files[0].path);
  const original = await readFile(broken);
  await writeFile(broken, Buffer.alloc(original.length, 120));
  try {
    await page.getByRole('button', { name: '更新', exact: true }).click();
    await page.waitForFunction(() => window.swipyHost.getState().message.startsWith('更新失败'));
    assert.equal(await page.evaluate(() => window.swipyHost.getState().buildId), 'stable-a');
    record('Corrupted B is rejected without switching A');
  } finally { await writeFile(broken, original); }
  await page.getByRole('button', { name: '更新', exact: true }).click();
  await page.getByRole('button', { name: '重启', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.swipyHost.getState().buildId), 'stable-a');
  await screenshot(page, '02-ready-to-restart');
  await page.getByRole('button', { name: '重启', exact: true }).click(); await waitBuild(page, 'stable-b');
  assert.equal(await second.evaluate(() => window.swipyHost.getState().buildId), 'stable-a');
  record('Manual restart switches B; other tab remains A');
  await second.close();
  const serverA = join(extension, 'static/versions/stable/stable-a');
  await rename(serverA, `${serverA}.withheld`);
  try {
    await page.evaluate(() => localStorage.setItem('swipyrss-host:/i/:selected', 'stable-a'));
    await page.reload(); await waitBuild(page, 'stable-a', 'enhanced');
    record('Removed server A remains runnable from browser cache');
    await context.setOffline(true); await page.reload(); await waitBuild(page, 'stable-a', 'enhanced');
    await context.setOffline(false);
    record('Cached program boots offline without treating API errors as boot failure');
    await page.evaluate(() => caches.delete('swipyrss-host:%2Fi%2F:v1:build:stable-a'));
    await page.reload(); await waitBuild(page, 'stable-b');
    record('Missing cache and removed server build recover to Stable B');
  } finally { await context.setOffline(false); await rename(`${serverA}.withheld`, serverA); }
  assert.deepEqual(await credential(page), auth);
  record('Update and recovery preserve IndexedDB credentials');

  // Exercise native FreshRSS config, permissions, CSRF, and manual imports.
  const adminContext = await browser.newContext(); const admin = await adminContext.newPage();
  await nativeLogin(admin, username); await admin.goto(configUrl);
  await admin.locator('#runtime_mode').selectOption('direct');
  await admin.getByRole('button', { name: '保存', exact: true }).click();
  await admin.getByText('运行方式已保存', { exact: false }).waitFor();
  assert.equal((await (await fetch(`${appUrl}&a=runtime`)).json()).runtimeMode, 'direct');
  record('Native admin settings persist the single runtime_mode value');
  const noCsrf = await admin.request.post(configUrl, { form: { swipy_action: 'save', runtime_mode: 'enhanced' } });
  assert.equal(noCsrf.status(), 403);
  assert.equal((await (await fetch(`${appUrl}&a=runtime`)).json()).runtimeMode, 'direct');
  record('Native CSRF rejects forged settings writes');
  const readerContext = await browser.newContext(); const reader = await readerContext.newPage();
  await nativeLogin(reader, 'reader');
  const refused = await reader.goto(configUrl); assert.equal(refused.status(), 403);
  record('Non-admin cannot access system extension configuration');
  await readerContext.close();
  const imported = join(extension, 'imports/reader.zip');
  await writeFile(imported, await readFile(join(root, 'release/test/swipyrss.zip')));
  await admin.goto(configUrl); await admin.getByRole('button', { name: '处理导入包', exact: true }).click();
  await admin.getByText('reader.zip：安装成功', { exact: false }).waitFor();
  record('Native admin form imports the standalone frontend ZIP');
  await page.evaluate(() => window.swipyHost.check());
  assert.equal(await page.evaluate(() => window.swipyHost.getState().configuredMode), 'direct');
  await page.evaluate(() => window.swipyHost.reload());
  await waitBuild(page, 'stable-b', 'direct');
  assert.ok(page.url().includes('a=direct'));
  assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration('/i/'))), false);
  const directResponse = await page.reload(); await waitBuild(page, 'stable-b', 'direct');
  assert.equal(directResponse.fromServiceWorker(), false);
  assert.deepEqual(await credential(page), auth);
  await screenshot(page, '03-direct-mode');
  record('Enhanced to direct bypasses old cache, unregisters own worker, preserves auth');
  setMode('auto'); await page.goto(appUrl); await waitBuild(page, 'stable-b', 'direct');
  await page.evaluate(() => window.swipyHost.check()); await page.evaluate(() => window.swipyHost.reload());
  await waitBuild(page, 'stable-b', 'enhanced');
  record('Direct to auto synchronizes the value and re-enables enhanced mode');
  await adminContext.close();

  const insecure = `http://swipyrss.test:${new URL(origin).port}/i/?c=swipyrss&preview=1`;
  const plainContext = await browser.newContext(); const plain = await plainContext.newPage();
  await plainContext.route('**/*a=check*', (route) => route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
  await plain.goto(insecure); await waitBuild(plain, 'stable-b', 'direct');
  assert.equal(await plain.evaluate(() => isSecureContext), false);
  await screenshot(plain, '04-http-direct');
  record('Non-localhost HTTP automatically falls back to ordinary React');
  await plainContext.close();
  setMode('enhanced');
  const forcedContext = await browser.newContext(); const forced = await forcedContext.newPage();
  await forcedContext.route('**/*a=check*', (route) => route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
  await forced.goto(insecure); await forced.getByText('当前浏览器或地址不支持程序缓存', { exact: false }).waitFor();
  await forced.getByRole('link', { name: '使用普通网页', exact: true }).click();
  await waitBuild(forced, 'stable-b', 'direct');
  record('Explicit enhanced mode explains failure and offers direct recovery');
  await forcedContext.close(); setMode('auto');

  // The direct endpoint must not use poisoned build responses from Cache Storage.
  await page.evaluate(async () => {
    const names = await caches.keys();
    for (const name of names.filter((name) => name.includes(':build:'))) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (new URL(request.url).searchParams.get('f')?.endsWith('.js')) await cache.put(request, new Response('throw new Error("poisoned cached JS")', { headers: { 'Content-Type': 'application/javascript' } }));
      }
    }
  });
  await page.goto(`${appUrl}&a=direct`); await waitBuild(page, 'stable-b', 'direct');
  record('Direct recovery bypasses cached program JS as well as HTML');
  const cached = await page.evaluate(async () => {
    const urls = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    return urls;
  });
  assert.ok(!cached.some((url) => url.includes('greader.php') || url.includes('c=auth') || url.includes('a=runtime')));
  record('Worker never caches gReader, native auth, or runtime settings responses');
  assert.deepEqual(errors, []);

  // Replacing a previous worker at the same /i/ scope must not trap the new app.
  const legacyFile = join(app, 'p/i/swipy-legacy-worker.js');
  await writeFile(legacyFile, `self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', event => {
      const url = new URL(event.request.url);
      if (event.request.mode === 'navigate' && url.searchParams.get('c') === 'swipyrss'
          && [null,'index'].includes(url.searchParams.get('a'))) event.respondWith(fetch(event.request));
    });`);
  const legacyContext = await browser.newContext();
  await legacyContext.route('**/*a=check*', (route) => route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
  const legacy = await legacyContext.newPage();
  await legacy.goto(`${origin}/i/?c=auth&a=login`);
  await legacy.evaluate(async () => {
    await navigator.serviceWorker.register('/i/swipy-legacy-worker.js', { scope: '/i/' });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await legacy.goto(`${appUrl}&preview=1`); await waitBuild(legacy, 'stable-b', 'enhanced');
  assert.ok(!(await legacy.evaluate(() => navigator.serviceWorker.controller.scriptURL)).includes('legacy'));
  await legacyContext.close(); await rm(legacyFile);
  record('New host replaces a previous worker at the same FreshRSS scope');

  // A fresh client must have an actionable first-install screen if the server has no builds.
  const indexPath = join(extension, 'storage/versions.json'); const indexBytes = await readFile(indexPath);
  await rm(indexPath);
  const emptyContext = await browser.newContext();
  await emptyContext.route('**/*a=check*', (route) => route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
  const empty = await emptyContext.newPage();
  try {
    await empty.goto(`${appUrl}&preview=1`);
    await empty.getByText('服务器尚未安装可用前端包。', { exact: true }).waitFor();
    await empty.getByRole('button', { name: '重试', exact: true }).waitFor();
    await writeFile(indexPath, indexBytes);
    await empty.getByRole('button', { name: '重试', exact: true }).click(); await waitBuild(empty, 'stable-b');
  } finally { await writeFile(indexPath, indexBytes); await emptyContext.close(); }
  record('Empty installation provides retry and recovers after a package is installed');

  await context.close(); await browser.close(); browser = null;
  const profile = await mkdtemp(join(work, 'profile-'));
  const launchOptions = { headless: true, timeout: 20000, executablePath: process.env.SWIPY_BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' };
  context = await chromium.launchPersistentContext(profile, launchOptions);
  await context.route('**/*a=check*', (route) => route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
  const beforeClose = await context.newPage(); await beforeClose.goto(`${appUrl}&preview=1`); await waitBuild(beforeClose, 'stable-b', 'enhanced');
  await context.close();
  context = await chromium.launchPersistentContext(profile, launchOptions);
  await context.setOffline(true);
  const afterClose = await context.newPage(); await afterClose.goto(`${appUrl}&preview=1`); await waitBuild(afterClose, 'stable-b', 'enhanced');
  record('Full browser restart can boot the selected program offline from disk');
} catch (error) {
  results.push({ name: 'browser integration', status: 'failed', detail: error.stack }); console.error(error.stack);
  if (context?.pages()[0]) {
    console.error('Loader:', await context.pages()[0].locator('#swipy-status').textContent().catch(() => 'unavailable'));
    await screenshot(context.pages()[0], 'failure').catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await context?.close(); await browser?.close(); server.kill('SIGTERM'); await log.close(); setMode('auto');
  await writeFile(join(work, 'results.json'), JSON.stringify({ results }, null, 2) + '\n');
  if (!process.exitCode) {
    // Leave the manual dev server with the real Test package, not the synthetic A/B versions.
    await rm(join(extension, 'storage/versions.json'), { force: true });
    await rm(join(extension, 'static/versions'), { recursive: true, force: true });
    install(join(root, 'release/test/swipyrss.zip'));
  }
  console.log(`${results.filter((result) => result.status === 'passed').length} browser scenarios passed.`);
}
