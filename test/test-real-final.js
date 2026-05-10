const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const extensionPath = path.resolve(__dirname, 'wechat-mp-markdown');
  const userDataDir = path.join(__dirname, 'playwright-profile');

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    viewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  await page.goto('https://mp.weixin.qq.com/cgi-bin/home');
  await page.waitForTimeout(3000);

  // 恢复登录
  const links = await page.evaluate(() => {
    const r = [];
    document.querySelectorAll('a').forEach(a => {
      r.push({ text: a.textContent.trim(), href: a.href });
    });
    return r;
  });
  const loginLink = links.find(l => l.text === '登录');
  if (loginLink) {
    console.log('恢复登录...');
    await page.goto(loginLink.href);
    await page.waitForTimeout(5000);
  }

  // 点击文章
  console.log('点击文章...');
  try {
    await page.getByText('文章', { exact: true }).first().click();
  } catch (e) {
    console.log('点击失败:', e.message);
    await browser.close();
    return;
  }
  await page.waitForTimeout(5000);

  // 找到编辑页面
  let editorPage = null;
  for (const p of browser.pages()) {
    if (p.url().includes('appmsg')) {
      editorPage = p;
      break;
    }
  }
  if (!editorPage) {
    console.log('未找到编辑页面');
    await browser.close();
    return;
  }

  console.log('编辑页面URL:', editorPage.url());
  await editorPage.screenshot({ path: '/Users/fanhuan/project/gzhmd/screenshot-final-editor.png', fullPage: true });

  // 分析编辑器DOM
  const domInfo = await editorPage.evaluate(() => {
    const r = [];
    document.querySelectorAll('[contenteditable]').forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      r.push({
        i, tag: el.tagName, id: el.id,
        cls: el.className.slice(0, 100),
        ce: el.contentEditable,
        ph: el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || '',
        w: Math.round(rect.width), h: Math.round(rect.height),
      });
    });
    return r;
  });
  console.log('编辑器DOM:', JSON.stringify(domInfo, null, 2));

  // 测试FAB
  const fab = await editorPage.locator('#gzhmd-fab').isVisible().catch(() => false);
  console.log('FAB:', fab);

  if (!fab) {
    console.log('FAB未显示');
    await browser.close();
    return;
  }

  // 点击浮窗
  await editorPage.click('#gzhmd-fab');
  await editorPage.waitForTimeout(1500);
  await editorPage.screenshot({ path: '/Users/fanhuan/project/gzhmd/screenshot-final-panel.png', fullPage: true });

  const iframeEl = await editorPage.locator('#gzhmd-iframe').elementHandle();
  const iframe = await iframeEl.contentFrame();
  if (!iframe) {
    console.log('iframe获取失败');
    await browser.close();
    return;
  }

  // 输入测试内容
  const testMd = `# 真实编辑器测试\n\n**粗体文字** *斜体文字* \`inline code\`\n\n- 列表项 1\n- 列表项 2\n  - 子列表\n\n> 这是一段引用内容\n\n| 名称 | 值 |\n|------|-----|\n| A | 1 |\n| B | 2 |`;
  await iframe.fill('#md-input', testMd);
  await iframe.waitForTimeout(800);
  await editorPage.screenshot({ path: '/Users/fanhuan/project/gzhmd/screenshot-final-preview.png', fullPage: true });

  // 点击插入
  await iframe.click('#btn-insert');
  await editorPage.waitForTimeout(3000);
  await editorPage.screenshot({ path: '/Users/fanhuan/project/gzhmd/screenshot-final-inserted.png', fullPage: true });

  // 检查编辑器内容
  const editorHtml = await editorPage.evaluate(() => {
    const editors = document.querySelectorAll('[contenteditable="true"]');
    let best = null, bestArea = 0;
    for (const el of editors) {
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = el; }
    }
    return best ? best.innerHTML.substring(0, 1500) : 'NO_EDITOR';
  });
  console.log('编辑器内容:', editorHtml.substring(0, 800));

  // 测试复制
  await editorPage.click('#gzhmd-fab');
  await editorPage.waitForTimeout(1000);
  const iframeEl2 = await editorPage.locator('#gzhmd-iframe').elementHandle();
  const iframe2 = await iframeEl2.contentFrame();
  await iframe2.click('#btn-copy');
  await editorPage.waitForTimeout(1500);
  await editorPage.screenshot({ path: '/Users/fanhuan/project/gzhmd/screenshot-final-copied.png', fullPage: true });

  const toastText = await iframe2.evaluate(() => {
    const t = document.querySelector('.toast');
    return t ? t.textContent : 'NO_TOAST';
  });
  console.log('复制提示:', toastText);

  console.log('测试完成');
  await editorPage.waitForTimeout(10000);
  await browser.close();
})();
