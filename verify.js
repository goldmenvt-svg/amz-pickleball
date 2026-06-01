const { chromium } = require('playwright');
const path = require('path');

const FILE = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');
const SS = (name) => path.join(__dirname, 'screenshots', name + '.png');

const { mkdirSync } = require('fs');
mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true });

let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { console.log('    ✅', label); passed++; }
  else { console.log('    ❌', label); failed++; }
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const page = await browser.newPage();

  // ─── STEP 1: Desktop hero ───
  console.log('\n[1] Desktop 1280px — Hero');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(FILE);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: SS('01-hero-desktop'), fullPage: false });
  const heroVisible = await page.isVisible('.hero');
  check('Hero section hiển thị', heroVisible);

  // ─── STEP 2: Nav link scroll ───
  console.log('\n[2] Nav "Liên Hệ" → scroll tới #lien-he');
  await page.click('nav .nav-links a[href="#lien-he"]');
  await page.waitForTimeout(1000);
  const sectionInView = await page.evaluate(() => {
    const el = document.getElementById('lien-he');
    const rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0;
  });
  check('#lien-he cuộn vào viewport', sectionInView);
  await page.screenshot({ path: SS('02-contact-section'), fullPage: false });

  // ─── STEP 3: Layout 2 cột desktop ───
  console.log('\n[3] Layout contact-grid');
  const cols = await page.evaluate(() => {
    return getComputedStyle(document.querySelector('.contact-grid')).gridTemplateColumns;
  });
  const isTwoCol = cols.trim().split(/\s+/).length === 2;
  check('2 cột desktop (' + cols + ')', isTwoCol);

  // Force reveal animations (IntersectionObserver không reliable trong Playwright file://)
  await page.evaluate(() => {
    document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach(el => el.classList.add('visible'));
  });
  await page.waitForTimeout(400);

  // ─── STEP 4: Submit rỗng → validation errors ───
  console.log('\n[4] Submit rỗng → validation errors');
  await page.evaluate(() => document.getElementById('contactSubmit').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);
  await page.click('#contactSubmit');
  await page.waitForTimeout(500);
  const errCount = await page.$$eval('.field-error.show', els => els.length);
  check('4 field errors hiển thị (thực tế: ' + errCount + ')', errCount === 4);
  await page.screenshot({ path: SS('03-validation-empty'), fullPage: false });

  // ─── STEP 5: SĐT sai format ───
  console.log('\n[5] SĐT sai format "123"');
  await page.fill('#cf-phone', '123');
  await page.press('#cf-phone', 'Tab');
  await page.waitForTimeout(300);
  const phoneErr = await page.isVisible('#err-phone.show');
  check('Phone error khi SĐT sai format', phoneErr);

  // ─── STEP 6: Email sai format ───
  console.log('\n[6] Email sai format "notanemail"');
  await page.fill('#cf-email', 'notanemail');
  await page.press('#cf-email', 'Tab');
  await page.waitForTimeout(300);
  const emailErr = await page.isVisible('#err-email.show');
  check('Email error khi format sai', emailErr);
  await page.screenshot({ path: SS('04-inline-errors'), fullPage: false });

  // ─── STEP 7: Điền hợp lệ → success ───
  console.log('\n[7] Điền đầy đủ hợp lệ → success card');

  // Điền từng field theo thứ tự, trigger blur rõ ràng
  await page.fill('#cf-name', 'Nguyễn Văn Test');
  await page.press('#cf-name', 'Tab');
  await page.waitForTimeout(100);

  await page.fill('#cf-phone', '0914859927');
  await page.press('#cf-phone', 'Tab');
  await page.waitForTimeout(100);

  await page.fill('#cf-email', 'test@amzpickleball.vn');
  await page.press('#cf-email', 'Tab');
  await page.waitForTimeout(100);

  await page.selectOption('#cf-type', 'dat-san');
  await page.press('#cf-type', 'Tab');
  await page.waitForTimeout(100);

  await page.fill('#cf-message', 'Tôi muốn đặt sân cho nhóm 6 người vào cuối tuần này.');
  await page.press('#cf-message', 'Tab');
  await page.waitForTimeout(200);

  // Kiểm tra values trước submit
  const vals = await page.evaluate(() => ({
    name: document.getElementById('cf-name').value,
    phone: document.getElementById('cf-phone').value,
    email: document.getElementById('cf-email').value,
    type: document.getElementById('cf-type').value,
    message: document.getElementById('cf-message').value,
  }));
  console.log('    Values:', JSON.stringify(vals));
  const errsBefore = await page.$$eval('.field-error.show', els => els.map(e => e.id));
  console.log('    Errors còn hiển thị:', errsBefore.length ? errsBefore.join(', ') : 'none');

  await page.screenshot({ path: SS('05-form-filled'), fullPage: false });

  // Debug: chạy validators trực tiếp trong page context
  const validatorDebug = await page.evaluate(() => {
    const form = document.getElementById('contactForm');
    const validators = {
      name:    v => v.trim().length >= 2,
      phone:   v => /(03|05|07|08|09)\d{8}/.test(v.replace(/\s/g, '')),
      email:   v => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
      type:    v => v !== '',
      message: v => v.trim().length >= 10,
    };
    const results = {};
    ['name','phone','email','type','message'].forEach(field => {
      const el = form.querySelector('[data-field="' + field + '"]');
      if (el) results[field] = { value: el.value.substring(0, 30), valid: validators[field](el.value) };
    });
    return results;
  });
  console.log('    Validator debug:', JSON.stringify(validatorDebug, null, 2));

  // Submit — dùng DOM .click() và probe submit event
  const consoleErrors = [];
  page.on('pageerror', err => consoleErrors.push(err.message));

  const submitFired = await page.evaluate(() => {
    return new Promise(resolve => {
      const form = document.getElementById('contactForm');
      const btn = document.getElementById('contactSubmit');
      let fired = false;
      const probe = () => { fired = true; };
      form.addEventListener('submit', probe, { capture: true, once: true });
      btn.click();
      setTimeout(() => {
        form.removeEventListener('submit', probe, true);
        resolve(fired);
      }, 300);
    });
  });
  console.log('    Submit event fired:', submitFired);
  console.log('    Đợi mock submit 1.4s...');

  try {
    await page.waitForSelector('#contactSuccess:not([hidden])', { timeout: 4000 });
    const successVisible = await page.isVisible('#contactSuccess');
    check('Success card hiển thị sau submit', successVisible);
  } catch {
    check('Success card hiển thị sau submit', false);
    const btnText = await page.$eval('#contactSubmit', el => el.textContent.trim());
    const formHidden = await page.$eval('#contactForm', el => el.hidden);
    console.log('    DEBUG — button text:', btnText, '| form hidden:', formHidden);
    const remainingErrs = await page.$$eval('.field-error.show', els => els.map(e => e.id));
    console.log('    DEBUG — errors còn lại:', remainingErrs.join(', ') || 'none');
    if (consoleErrors.length) console.log('    Page errors:', consoleErrors);
  }
  await page.screenshot({ path: SS('06-success-card'), fullPage: false });

  // ─── STEP 8: Reset form ───
  console.log('\n[8] Reset form');
  const hasSuccessCard = await page.evaluate(() => !document.getElementById('contactSuccess').hidden);
  if (hasSuccessCard) {
    await page.evaluate(() => document.getElementById('resetForm').click());
    await page.waitForTimeout(600);
    const formBack = await page.evaluate(() => !document.getElementById('contactForm').hidden);
    check('Form reset về trạng thái ban đầu', formBack);
  } else {
    console.log('    (skip — success card chưa hiển thị)');
  }

  // ─── STEP 9: Mobile 375px ───
  console.log('\n[9] Mobile 375px (iPhone SE)');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(FILE);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: SS('07-mobile-hero'), fullPage: false });

  await page.evaluate(() => document.getElementById('lien-he').scrollIntoView());
  await page.waitForTimeout(800);

  const mobileCols = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.contact-grid')).gridTemplateColumns
  );
  const isOneCol = mobileCols.trim().split(/\s+/).length === 1;
  check('1 cột mobile (' + mobileCols + ')', isOneCol);

  const inputFs = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.form-control')).fontSize
  );
  check('Input font-size 16px (không zoom iOS): ' + inputFs, inputFs === '16px');
  await page.screenshot({ path: SS('08-mobile-contact'), fullPage: false });

  // ─── STEP 10: Hamburger menu ───
  console.log('\n[10] Hamburger menu mobile');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  await page.click('.hamburger');
  await page.waitForTimeout(400);
  const menuOpen = await page.isVisible('.mobile-menu.open');
  check('Mobile menu mở khi click hamburger', menuOpen);
  await page.screenshot({ path: SS('09-mobile-menu'), fullPage: false });
  await page.click('.hamburger');
  await page.waitForTimeout(300);

  // ─── STEP 11: Nav scrolled state ───
  console.log('\n[11] Nav scroll state desktop');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(FILE);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.waitForTimeout(400);
  const navScrolled = await page.isVisible('nav.scrolled');
  check('Nav thêm class .scrolled khi scroll xuống', navScrolled);
  await page.screenshot({ path: SS('10-nav-scrolled'), fullPage: false });

  // ─── KẾT QUẢ ───
  console.log('\n══════════════════════════════════════');
  console.log('KẾT QUẢ WALKTHROUGH');
  console.log('  ✅ Passed:', passed);
  console.log('  ❌ Failed:', failed);
  console.log('  Screenshots: d:\\website test\\screenshots\\');
  console.log('══════════════════════════════════════\n');

  await page.waitForTimeout(2000);
  await browser.close();
})();
