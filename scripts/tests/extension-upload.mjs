import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { open, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { setup, php, app, origin, root, work, extension, username, password } from './freshrss-environment.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SWIPY_PLAYWRIGHT || 'playwright');
await setup();
const zip = await readFile(join(root, 'release/test/swipyrss.zip'));
const log = await open(join(work, 'upload-server.log'), 'w');
// Explicit limits make oversized-upload behavior deterministic without changing php.ini.
const server = spawn(php, ['-d', 'upload_max_filesize=1M', '-d', 'post_max_size=24M', '-S', `localhost:${new URL(origin).port}`, '-t', join(app, 'p')], { cwd: app, stdio: ['ignore', log.fd, log.fd] });
const configUrl = `${origin}/i/?c=extension&a=configure&e=SwipyRSS`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;
let passed = 0;
const record = (name) => { passed++; console.log(`PASS ${name}`); };
async function login(page, user) {
  await page.goto(`${origin}/i/?c=auth&a=login`);
  await page.locator('#username').fill(user);
  await page.locator('#passwordPlain').fill(password);
  await page.locator('#loginButton').click();
  await page.waitForFunction(() => !document.querySelector('#passwordPlain'));
}
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error('Upload test server exited; inspect upload-server.log');
    try { if ((await fetch(`${origin}/i/?c=auth&a=login`)).ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  assert.ok(ready, 'FreshRSS server must start');
  browser = await chromium.launch({ headless: true, executablePath: process.env.SWIPY_BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, username);
  await page.goto(configUrl);
  const input = page.locator('#frontend_zip');
  assert.equal(await input.getAttribute('accept'), '.zip,application/zip,application/x-zip-compressed');
  assert.equal(await input.locator('..').locator('button').textContent(), '上传并安装');
  await input.setInputFiles({ name: 'swipyrss.zip', mimeType: 'application/zip', buffer: zip });
  await page.getByRole('button', { name: '上传并安装', exact: true }).click();
  await page.getByText('前端包上传并安装成功。', { exact: true }).waitFor();
  const afterInstall = await readFile(join(extension, 'storage/versions.json'), 'utf8');
  assert.ok(JSON.parse(afterInstall).builds.some((b) => b.channel === 'test'));
  record('Native file picker uploads and installs a real frontend ZIP');
  await page.screenshot({ path: join(work, 'upload-success.png'), fullPage: true });

  // Open the real native slider; a synthetic hidden input cannot verify visibility or navigation.
  await page.goto(`${origin}/i/?c=extension&a=index`);
  await page.locator('a.open-slider.configure[href*="e=SwipyRSS"]').click();
  const slider = page.locator('#slider');
  await slider.locator('#frontend_zip').waitFor();
  const sliderUrl = page.url();
  const documentMarker = await page.evaluate(() => (window.swipySliderTestMarker = Math.random()));
  async function expectSliderNotice(text) {
    await slider.getByText(text, { exact: false }).waitFor({ timeout: 5000 });
    assert.equal(page.url(), sliderUrl, 'Slider submission must not navigate');
    assert.equal(await page.evaluate(() => window.swipySliderTestMarker), documentMarker, 'The parent document must remain mounted');
    assert.ok(await slider.evaluate((node) => node.classList.contains('active') && node.getBoundingClientRect().width > 0));
  }
  await slider.locator('#frontend_zip').setInputFiles({ name: 'swipyrss.zip', mimeType: 'application/zip', buffer: zip });
  await slider.getByRole('button', { name: '上传并安装', exact: true }).click();
  await expectSliderNotice('前端包上传并安装成功。');
  record('Actual native slider upload stays open without navigating the parent page');
  await slider.locator('#runtime_mode').selectOption('direct');
  await slider.getByRole('button', { name: '保存', exact: true }).click();
  await expectSliderNotice('运行方式已保存');
  assert.equal(await slider.locator('#runtime_mode').inputValue(), 'direct');
  record('Slider mode save preserves visibility and the selected mode');
  await slider.locator('#runtime_mode').selectOption('auto');
  await slider.getByRole('button', { name: '保存', exact: true }).click();
  await expectSliderNotice('运行方式已保存');
  await slider.getByRole('button', { name: '处理导入包', exact: true }).click();
  await expectSliderNotice('imports/ 中没有待处理 ZIP。');
  record('Slider directory import displays its result in place');
  // Use an invalid channel to exercise the real check handler without contacting GitHub.
  await slider.locator('#channel').evaluate((select) => {
    const option = new Option('invalid test channel', 'invalid'); select.add(option); select.value = 'invalid';
  });
  await slider.getByRole('button', { name: '检查 GitHub', exact: true }).click();
  await expectSliderNotice('无效通道');
  record('Slider GitHub check errors stay visible in the open settings');
  await slider.locator('#frontend_zip').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
  await slider.getByRole('button', { name: '上传并安装', exact: true }).click();
  await expectSliderNotice('ZIP 无效或文件过多');
  record('Slider upload errors remain visible without closing the settings');
  await page.route('**/*a=configure*ajax=1*', (route) => route.fulfill({ status: 413, body: 'Request too large' }));
  await slider.getByRole('button', { name: '处理导入包', exact: true }).click();
  await expectSliderNotice('上传文件超过服务器请求大小限制');
  assert.equal(await slider.getByRole('button', { name: '处理导入包', exact: true }).isEnabled(), true);
  await page.unroute('**/*a=configure*ajax=1*');
  record('HTTP errors are visible in the slider and buttons recover for retry');
  await slider.getByRole('button', { name: '处理导入包', exact: true }).click();
  await expectSliderNotice('imports/ 中没有待处理 ZIP。');
  await page.screenshot({ path: join(work, 'slider-submit.png'), fullPage: true });

  async function upload(name, buffer, expected) {
    await page.goto(configUrl);
    await page.locator('#frontend_zip').setInputFiles({ name, mimeType: 'application/zip', buffer });
    await page.getByRole('button', { name: '上传并安装', exact: true }).click();
    await page.getByText(expected, { exact: false }).waitFor();
    assert.equal(await readFile(join(extension, 'storage/versions.json'), 'utf8'), afterInstall);
  }
  await upload('broken.zip', Buffer.from('not a zip'), 'ZIP 无效或文件过多');
  record('Invalid ZIP reports an error and preserves installed builds');
  await upload('frontend.txt', zip, '请选择 .zip 格式的独立前端包');
  record('Non-ZIP filenames are rejected');
  await upload('too-large.zip', Buffer.alloc(1024 * 1024 + 1), '上传文件过大');
  record('PHP upload size limit produces an actionable error');

  await page.goto(configUrl);
  const csrf = await page.locator('#frontend_zip').evaluate((input) => input.form.querySelector('[name="_csrf"]').value);
  const noFile = await context.request.post(configUrl, { multipart: { _csrf: csrf, swipy_action: 'upload' } });
  assert.ok((await noFile.text()).includes('请选择要上传的前端 ZIP 包'));
  record('Missing file produces a clear error');
  const noCsrf = await context.request.post(configUrl, { multipart: { swipy_action: 'upload', frontend_zip: { name: 'swipyrss.zip', mimeType: 'application/zip', buffer: zip } } });
  assert.equal(noCsrf.status(), 403);
  record('Native CSRF rejects unauthorized upload requests');

  const reader = await browser.newContext();
  const readerPage = await reader.newPage(); await login(readerPage, 'reader');
  const refused = await reader.request.post(configUrl, { multipart: { _csrf: await readerPage.locator('[name="_csrf"]').first().getAttribute('value'), swipy_action: 'upload', frontend_zip: { name: 'swipyrss.zip', mimeType: 'application/zip', buffer: zip } } });
  assert.equal(refused.status(), 403);
  assert.equal(await readFile(join(extension, 'storage/versions.json'), 'utf8'), afterInstall);
  record('Non-admin multipart upload is rejected without changing builds');
  console.log(`${passed} upload scenarios passed.`);
} finally {
  if (browser) await browser.close();
  server.kill();
  await log.close();
}
