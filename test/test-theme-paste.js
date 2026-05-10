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
      console.log(`本地服务器启动: http://localhost:${port}`);
      resolve(server);
    });
  });
}

(async () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const extensionPath = path.resolve(__dirname, '..');
  const userDataDir = path.join(__dirname, 'playwright-profile');
  const port = 8765;

  const server = await startServer(projectRoot, port);

  // 临时修改 manifest 添加 localhost 匹配
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

  // 检查 FAB
  const fabVisible = await page.locator('#gzhmd-fab').isVisible().catch(() => false);
  console.log('FAB visible:', fabVisible);

  if (!fabVisible) {
    console.log('FAB 未显示，尝试手动注入...');
    const contentJs = fs.readFileSync(path.join(extensionPath, 'content.js'), 'utf8');
    const contentCss = fs.readFileSync(path.join(extensionPath, 'content.css'), 'utf8');
    await page.addStyleTag({ content: contentCss });
    await page.addScriptTag({ content: contentJs });
    await page.waitForTimeout(2000);
  }

  const fabVisible2 = await page.locator('#gzhmd-fab').isVisible().catch(() => false);
  console.log('FAB visible (after inject):', fabVisible2);

  if (!fabVisible2) {
    console.log('FAB 仍未显示，测试终止');
    fs.writeFileSync(manifestPath, manifestOriginal);
    await browser.close();
    server.close();
    return;
  }

  // 先清空编辑器
  await page.evaluate(() => {
    const editor = document.querySelector('.ProseMirror');
    if (editor) editor.innerHTML = '<p><br></p>';
  });

  // 点击 FAB 打开编辑器
  await page.click('#gzhmd-fab');
  await page.waitForTimeout(1500);

  const iframeEl = await page.locator('#gzhmd-iframe').elementHandle();
  const iframe = await iframeEl.contentFrame();
  if (!iframe) {
    console.log('iframe 获取失败');
    fs.writeFileSync(manifestPath, manifestOriginal);
    await browser.close();
    server.close();
    return;
  }

  // 输入测试内容
  const testMd = `# 测试标题\n\n**粗体** 内容\n\n> 引用文本`;
  await iframe.fill('#md-input', testMd);
  await iframe.waitForTimeout(500);

  // 切换主题到"莫兰迪"
  await iframe.selectOption('#preview-theme', 'theme-wemd-morandi');
  await iframe.waitForTimeout(500);

  await page.screenshot({ path: path.join(projectRoot, 'screenshot-theme-preview.png'), fullPage: true });
  console.log('预览截图已保存');

  // 点击插入
  await iframe.click('#btn-insert');
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(projectRoot, 'screenshot-theme-inserted.png'), fullPage: true });
  console.log('插入后截图已保存');

  // 检查编辑器内容
  const editorContent = await page.evaluate(() => {
    const editor = document.querySelector('.ProseMirror');
    if (!editor) return { html: 'NO_EDITOR', classes: [] };

    const classEls = [];
    editor.querySelectorAll('*').forEach(el => {
      if (el.className && el.className.trim()) {
        classEls.push({ tag: el.tagName, class: el.className });
      }
    });

    return {
      html: editor.innerHTML.substring(0, 2000),
      classes: classEls,
    };
  });

  console.log('编辑器 HTML:', editorContent.html.substring(0, 800));
  console.log('保留的 class:', JSON.stringify(editorContent.classes, null, 2));

  const hasInsertedContent = editorContent.html.includes('测试标题') || editorContent.html.includes('粗体');
  if (!hasInsertedContent) {
    console.log('❌ 内容根本没有插入成功！');
  } else {
    console.log('✅ 内容已插入');
  }

  const hasThemeClass = editorContent.classes.some(c =>
    c.class.includes('gzhmd-content') || c.class.includes('theme-')
  );

  // 检查内联样式中是否有莫兰迪主题特征
  const hasThemeStyles = editorContent.html.includes('rgb(58, 77, 57)') || editorContent.html.includes('Optima');

  if (hasThemeClass) {
    console.log('✅ 主题 class 已保留');
  } else if (hasInsertedContent && hasThemeStyles) {
    console.log('✅ 主题样式已通过内联 style 正确保留（class 被过滤是预期行为）');
  } else if (hasInsertedContent) {
    console.log('❌ 内容已插入但主题样式丢失——存在主题粘贴问题');
  }

  // 清理
  fs.writeFileSync(manifestPath, manifestOriginal);
  await browser.close();
  server.close();
})();
