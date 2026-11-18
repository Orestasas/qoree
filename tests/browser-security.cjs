const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
// Usage: NODE_PATH=<directory containing Playwright> node tests/browser-security.cjs [index.html] [output directory]
// Fresh browser profile, synthetic credentials, and every external request mocked. No real transactions.
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');
const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '../index.html'));
const OUT = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'qoree-browser-security-'));
fs.mkdirSync(OUT, { recursive: true });
const SEED = 'abcdefghijklmnopqrstuvwxyz'.repeat(3).slice(0, 55);
const PASSWORD = 'Synthetic_review_only_83!River';
const results = [], outbound = [], logs = [];
const secretForms = (s) => [s, s.toUpperCase(), Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64')];
const forbidden = [...secretForms(SEED), ...secretForms(PASSWORD)];
const hasSecret = (s) => forbidden.some((v) => String(s).includes(v));
function check(name, ok, detail) {
  results.push({ name, pass: !!ok, ...(detail ? { detail } : {}) });
  if (!ok) process.exitCode = 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}
async function stores(page) {
  return page.evaluate(async () => {
    const local = Object.fromEntries(Object.entries(localStorage));
    const session = Object.fromEntries(Object.entries(sessionStorage));
    const indexed = {};
    for (const info of await indexedDB.databases()) {
      const db = await new Promise((yes, no) => { const r = indexedDB.open(info.name); r.onsuccess = () => yes(r.result); r.onerror = no; });
      try {
        indexed[info.name] = {};
        for (const name of db.objectStoreNames) indexed[info.name][name] = await new Promise((yes, no) => {
          const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => yes(r.result); r.onerror = no;
        });
      } finally { db.close(); }
    }
    return { local, session, indexed };
  });
}
(async () => {
  const pageBytes = fs.readFileSync(PAGE);
  const server = http.createServer((req, res) => {
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    const headers = { 'Content-Type': 'text/html; charset=utf-8' };
    for (const line of fs.readFileSync(path.join(__dirname, '../cloudflare/_headers'), 'utf8').split('\n')) {
      const match = line.match(/^  ([^:]+): (.+)$/); if (match) headers[match[1]] = match[2];
    }
    res.writeHead(200, headers); res.end(pageBytes);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', async (route) => {
      const req = route.request(); const url = new URL(req.url());
      if (url.origin === origin) { await route.continue(); return; }
      outbound.push({ url: req.url(), method: req.method(), body: req.postData() || '' });
      let data = {};
      if (url.pathname.endsWith('/tick-info')) data = { tickInfo: { tick: 90000000, epoch: 200 } };
      else if (url.pathname.includes('/balances/')) data = { balance: { id: url.pathname.split('/').at(-1), balance: '1000000', validForTick: 90000000, incomingAmount: '1000000', outgoingAmount: '0', latestIncomingTransferTick: 1, latestOutgoingTransferTick: 0 } };
      else if (url.pathname.includes('/assets/')) data = { ownedAssets: [] };
      else if (url.pathname.endsWith('/getTransactionsForIdentity')) data = { hits: { total: 0 }, transactions: [], validForTick: 90000000 };
      else if (url.pathname.endsWith('/getLastProcessedTick')) data = { tickNumber: 90000000 };
      else if (url.hostname === 'static.qubic.org') data = [];
      else if (url.pathname.includes('/simple/price')) data = { 'qubic-network': { usd: 0.000001, usd_24h_change: 0, usd_market_cap: 1, last_updated_at: Math.floor(Date.now()/1000) } };
      else if (url.pathname.includes('market_chart')) data = { prices: [] };
      else if (url.hostname === 'api.gateio.ws') data = { currency: 'QUBIC', deposit_disabled: false, withdraw_disabled: false };
      if (url.pathname.endsWith('/broadcast-transaction')) throw new Error('No broadcast permitted in seed review');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*' } });
    });
    const page = await context.newPage();
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (e) => logs.push(String(e)));
    page.setDefaultTimeout(20000);
    const response = await page.goto(origin);
    const headers = response.headers();
    check('Packaged security headers are served with the production page',
      headers['content-security-policy'] === "frame-ancestors 'none'" && headers['x-frame-options'] === 'DENY'
      && headers['strict-transport-security'] === 'max-age=31536000' && headers['x-content-type-options'] === 'nosniff'
      && headers['referrer-policy'] === 'no-referrer' && headers['cross-origin-opener-policy'] === 'same-origin'
      && headers['cache-control'] === 'no-cache, no-transform');
    await page.getByRole('button', { name: 'Import seed', exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Import seed', exact: true }).click();
    await page.getByRole('textbox', { name: 'Seed', exact: true }).fill(SEED);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD);
    await page.getByRole('textbox', { name: 'Repeat password', exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Import wallet', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).waitFor({ state: 'visible' });
    check('Production page imports and encrypts synthetic seed', true);
    check('Seed and password absent from persistent browser storage', !hasSecret(JSON.stringify(await stores(page))));
    check('Seed absent from dashboard DOM and form values', !(await page.evaluate((s) => document.documentElement.textContent.includes(s) || [...document.querySelectorAll('input,textarea')].some(e => e.value.includes(s)), SEED)));
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Security', exact: true }).click();
    await page.getByRole('button', { name: 'Lock now', exact: true }).click();
    await page.getByRole('button', { name: 'Unlock', exact: true }).waitFor();
    check('Manual lock removes seed from DOM and input values', !(await page.evaluate((s) => document.documentElement.textContent.includes(s) || [...document.querySelectorAll('input,textarea')].some(e => e.value.includes(s)), SEED)));
    check('Reload convenience key absent by default after lock', !Object.keys((await stores(page)).session).some(k => k.includes('resume')));
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('deliberately-wrong-password');
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await page.getByText('Incorrect password.', { exact: true }).waitFor();
    check('Wrong password cannot unlock the wallet', await page.getByRole('button', { name: 'Unlock', exact: true }).isVisible());
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Sign a message', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(SEED);
    check('Signing refuses the full held seed', await page.getByRole('button', { name: 'Review', exact: true }).isDisabled());
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(SEED.slice(12,32));
    check('A seed fragment needs the generic warning confirmation', await page.getByRole('button', { name: 'Review', exact: true }).isDisabled());
    const probeStates = [];
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      await page.getByRole('textbox', { name: 'Message', exact: true }).fill(SEED.slice(0, 19) + letter);
      probeStates.push({ warning: await page.getByRole('checkbox').count(),
        disabled: await page.getByRole('button', { name: 'Review', exact: true }).isDisabled(),
        text: await page.locator('.sheet-body').innerText() });
    }
    // The message itself lives in the textarea value, not innerText, so only displayed feedback is compared.
    check('All 26 next-letter guesses produce identical warning and button state',
      probeStates.every(s => s.warning === 1 && s.disabled && s.text === probeStates[0].text));
    await page.getByRole('checkbox').check();
    check('Generic fragment warning can be confirmed without a secret match signal', await page.getByRole('button', { name: 'Review', exact: true }).isEnabled());
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Synthetic safe message for local review');
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    const hold = page.getByRole('button', { name: /Hold to sign/ });
    await hold.click();
    await page.getByRole('button', { name: 'Sign', exact: true }).waitFor();
    await page.waitForTimeout(700);
    await page.getByRole('button', { name: 'Sign', exact: true }).click();
    await page.getByText('Message signed', { exact: true }).waitFor();
    check('Ordinary message signing works without exposing seed', !(await page.locator('.signed-json').textContent()).includes(SEED));
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Accounts', exact: true }).click();
    await page.locator('.sheet-body .item').filter({ hasText: 'Main' }).click();
    await page.getByRole('button', { name: /^Show secret seed/ }).click();
    check('Saved seed reveal requires password again', await page.getByRole('textbox', { name: 'Wallet password', exact: true }).isVisible()
      && await page.locator('.seed-text').count() === 0);
    await page.getByRole('textbox', { name: 'Wallet password', exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Reveal seed', exact: true }).click();
    await page.locator('.seed-text').waitFor();
    check('Correct password reveals the expected synthetic seed', (await page.locator('.seed-text').textContent()) === SEED);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('blur'));
    });
    check('Background event removes saved seed from DOM and restores password entry',
      await page.locator('.seed-text').count() === 0 && await page.getByRole('textbox', { name: 'Wallet password', exact: true }).isVisible());
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
    check('Returning to the app does not re-reveal the seed', await page.locator('.seed-text').count() === 0);
    await page.getByRole('textbox', { name: 'Wallet password', exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Reveal seed', exact: true }).click();
    await page.locator('.seed-text').waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    check('Focus loss alone also conceals a saved seed', await page.locator('.seed-text').count() === 0);
    await page.getByRole('textbox', { name: 'Wallet password', exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Reveal seed', exact: true }).click();
    await page.locator('.seed-text').waitFor();
    await page.evaluate(() => { const now = Date.now.bind(Date); Date.now = () => now() + 11 * 60000; });
    await page.getByRole('button', { name: 'Unlock', exact: true }).waitFor();
    check('Idle timeout removes a revealed seed from document and inputs', !(await page.evaluate((s) => document.documentElement.textContent.includes(s) || [...document.querySelectorAll('input,textarea')].some(e => e.value.includes(s)), SEED)));
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Security', exact: true }).click();
    await page.getByRole('switch', { name: 'Stay unlocked on reload', exact: true }).check();
    await page.getByRole('button', { name: 'Lock now', exact: true }).click();
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).waitFor({ state: 'visible' });
    check('Opt-in reload state contains no literal seed/password', !hasSecret(JSON.stringify(await stores(page))));
    await page.reload();
    await page.getByRole('button', { name: 'Settings', exact: true }).waitFor({ state: 'visible' });
    check('Opt-in reload reopens wallet within its deadline', true);
    // On a phone or tablet the tab bar sits outside the screen a sheet covers: under an open sheet it's out of Tab's
    // reach too, so focus can't leave the sheet for it.
    await page.setViewportSize({ width: 800, height: 900 });
    await page.locator('nav.tabbar').waitFor();
    await page.locator('.account-slot button').first().click();
    await page.locator('.sheet').first().waitFor();
    let escaped = false;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Shift+Tab');
      if (await page.evaluate(() => Boolean(document.activeElement && document.activeElement.closest('nav.tabbar')))) escaped = true;
    }
    check('Tab can’t leave an open sheet for the tab bar under it', !escaped);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Security', exact: true }).click();
    await page.getByRole('button', { name: 'Lock now', exact: true }).click();
    await page.getByRole('button', { name: 'Unlock', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Unlock', exact: true }).waitFor();
    check('Manual lock prevents automatic reopening on reload', true);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole('button', { name: 'Create wallet', exact: true }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Show my seed', exact: true }).click();
    await page.getByRole('button', { name: 'Reveal seed', exact: true }).click();
    const draftSeed = await page.locator('.seed-text').textContent();
    forbidden.push(...secretForms(draftSeed));
    check('New wallet displays a valid generated test seed', /^[a-z]{55}$/.test(draftSeed));
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    check('Focus loss conceals a newly generated seed', !(await page.locator('body').innerText()).includes(draftSeed));
    await page.getByRole('button', { name: 'Reveal seed', exact: true }).click();
    check('Revealing preserves the original backup seed', (await page.locator('.seed-text').textContent()) === draftSeed);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    check('Returning to a draft backup keeps it concealed', !(await page.locator('body').innerText()).includes(draftSeed));
    await page.getByRole('button', { name: 'I’ve written it down', exact: true }).click();
    await page.getByRole('textbox', { name: 'Seed from your written copy', exact: true }).fill(draftSeed);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.getByRole('radio', { name: /This session only/ }).click();
    await page.getByRole('button', { name: 'Create wallet', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Accounts', exact: true }).click();
    await page.locator('.sheet-body .item').filter({ hasText: 'Main' }).click();
    await page.getByRole('button', { name: /^Show secret seed/ }).click();
    await page.getByRole('button', { name: 'Reveal seed', exact: true }).click();
    check('Backup confirmation produces the same session-only account seed', (await page.locator('.seed-text').textContent()) === draftSeed);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    check('Session-only saved account hides on focus loss', await page.locator('.seed-text').count() === 0);
    await page.getByRole('button', { name: 'Reveal seed', exact: true }).click();
    check('Session-only seed survives concealment', (await page.locator('.seed-text').textContent()) === draftSeed);
    check('Session-only seed absent from browser storage', !hasSecret(JSON.stringify(await stores(page))));
    await page.evaluate(() => { window.__testCopies = 0; navigator.clipboard.writeText = async () => { window.__testCopies++; }; });
    await page.locator('.seed-tools').getByRole('button', { name: 'Copy', exact: true }).click();
    await page.getByRole('button', { name: 'Copy anyway', exact: true }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.getByRole('button', { name: 'Copy anyway', exact: true }).click();
    check('A pending seed-copy confirmation cannot outlive focus loss', (await page.evaluate(() => window.__testCopies)) === 0);
    await page.getByRole('button', { name: 'Reveal seed', exact: true }).click();
    await page.locator('.seed-tools').getByRole('button', { name: 'Copy', exact: true }).click();
    await page.getByRole('button', { name: 'Copy anyway', exact: true }).click();
    check('An explicitly confirmed seed copy still works with current authorization', (await page.evaluate(() => window.__testCopies)) === 1);

    check('No seed/password in outgoing request URLs or bodies', !hasSecret(JSON.stringify(outbound)), `${outbound.length} mocked external requests`);
    check('No seed/password in browser logs', !hasSecret(JSON.stringify(logs)));
    check('No browser errors during the wallet flows', logs.length === 0);
    fs.writeFileSync(OUT + '/browser-results.json', JSON.stringify({ sha256: crypto.createHash('sha256').update(pageBytes).digest('hex'), results, requestCount: outbound.length, logs }, null, 2));
    console.log('Browser results:', OUT);
    await context.close();
  } finally { if (browser) await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((e) => { console.error(e.stack); process.exitCode = 1; });
