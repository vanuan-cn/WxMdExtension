const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

function startServer(rootDir, port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let filePath;
      if (req.url === '/' || req.url === '/test-page.html') {
        filePath = path.join(rootDir, 'test-page.html');
      } else {
        filePath = path.join(rootDir, req.url);
      }
      const ext = path.extname(filePath);
      const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
      };
      try {
        const data = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        res.end(data);
      } catch (e) {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(port, () => {
      resolve(server);
    });
  });
}

(async () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const extensionPath = path.resolve(__dirname, '..');
  const userDataDir = path.join(__dirname, 'playwright-profile');
  const port = 8766;

  const server = await startServer(projectRoot, port);

  const manifestPath = path.join(extensionPath, 'manifest.json');
  const manifestOriginal = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestOriginal);
  manifest.content_scripts[0].matches.push('http://localhost/*');
  manifest.web_accessible_resources[0].matches.push('http://localhost/*');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    viewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  await page.goto(`http://localhost:${port}/test-page.html`);
  await page.waitForTimeout(3000);

  const fabVisible = await page.locator('#gzhmd-fab').isVisible().catch(() => false);
  if (!fabVisible) {
    const contentJs = fs.readFileSync(path.join(extensionPath, 'content.js'), 'utf8');
    const contentCss = fs.readFileSync(path.join(extensionPath, 'content.css'), 'utf8');
    await page.addStyleTag({ content: contentCss });
    await page.addScriptTag({ content: contentJs });
    await page.waitForTimeout(2000);
  }

  const themes = [
    { value: 'theme-default', name: '默认', check: (html) => html.includes('color: rgb(0, 0, 0)') || html.includes('font-size: 20px') },
    { value: 'theme-elegant', name: '优雅', check: (html) => html.includes('border-radius: 6px') || html.includes('background-color: rgb(230, 247, 239)') },
    { value: 'theme-wemd-morandi', name: '莫兰迪', check: (html) => html.includes('rgb(58, 77, 57)') || html.includes('Optima') },
    { value: 'theme-wemd-gold', name: '黑金', check: (html) => html.includes('rgb(158, 128, 69)') || html.includes('Songti SC') },
    { value: 'theme-wemd-laser', name: '激光', check: (html) => html.includes('rgb(10, 14, 26)') || html.includes('rgb(0, 212, 255)') },
    { value: 'theme-wemd-sunset', name: '落日', check: (html) => html.includes('rgb(255, 248, 240)') || html.includes('rgb(196, 69, 54)') },
  ];

  const testMd = `# 测试标题\n\n**粗体** 内容\n\n> 引用文本`;
  let allPassed = true;

  for (const theme of themes) {
    console.log(`\n--- 测试主题: ${theme.name} ---`);

    // 清空编辑器
    await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror');
      if (editor) editor.innerHTML = '<p><br></p>';
    });

    // 打开编辑器
    await page.click('#gzhmd-fab');
    await page.waitForTimeout(1000);

    const iframeEl = await page.locator('#gzhmd-iframe').elementHandle();
    const iframe = await iframeEl.contentFrame();

    await iframe.fill('#md-input', testMd);
    await iframe.waitForTimeout(300);

    await iframe.selectOption('#preview-theme', theme.value);
    await iframe.waitForTimeout(300);

    // 点击插入
    await iframe.click('#btn-insert');
    await page.waitForTimeout(1500);

    // 关闭面板
    const panel = await page.locator('#gzhmd-panel').count();
    if (panel > 0) {
      await page.evaluate(() => document.getElementById('gzhmd-panel').remove());
    }

    // 检查编辑器内容
    const editorHtml = await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror');
      return editor ? editor.innerHTML : 'NO_EDITOR';
    });

    const hasContent = editorHtml.includes('测试标题');
    const hasThemeStyle = theme.check(editorHtml);

    if (hasContent && hasThemeStyle) {
      console.log(`✅ ${theme.name} 主题样式正确保留`);
    } else if (!hasContent) {
      console.log(`❌ ${theme.name} 内容未插入`);
      allPassed = false;
    } else {
      console.log(`❌ ${theme.name} 主题样式未保留`);
      console.log('HTML 片段:', editorHtml.substring(0, 400));
      allPassed = false;
    }
  }

  console.log(`\n${allPassed ? '✅ 所有主题测试通过' : '❌ 部分主题测试失败'}`);

  fs.writeFileSync(manifestPath, manifestOriginal);
  await browser.close();
  server.close();
})();
