(function () {
  'use strict';

  // 防止重复注入
  if (window.__gzhmd_injected) return;
  window.__gzhmd_injected = true;

  const EDITOR_URL = chrome.runtime.getURL('editor.html');

  function isEditPage() {
    const href = location.href;
    if (href.includes('/cgi-bin/appmsg') || href.includes('/cgi-bin/newappmsg')) {
      return true;
    }
    const editor = document.querySelector('#js_editor, .mp-editor, .ProseMirror, [data-placeholder*="正文"], .rich_media_content_editor');
    if (editor) return true;
    return false;
  }

  function pickLargest(els) {
    let best = null;
    let bestArea = 0;
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = el;
      }
    }
    return best;
  }

  function findEditorsInDoc(doc, source) {
    const bodySelectors = [
      '[data-placeholder*="正文"][contenteditable="true"]',
      '[data-placeholder*="从这里开始"][contenteditable="true"]',
      '[data-placeholder*="输入正文"][contenteditable="true"]',
      '[placeholder*="正文"][contenteditable="true"]',
      '#js_editor .ProseMirror[contenteditable="true"]',
      '#js_editor [contenteditable="true"]',
      '.ProseMirror[contenteditable="true"]',
      '.rich_media_content_editor [contenteditable="true"]',
      '.mp-editor [contenteditable="true"]',
      '.editor_body [contenteditable="true"]',
      '#edui1 [contenteditable="true"]',
      '[contenteditable="true"][data-placeholder]',
    ];
    const results = [];
    for (const s of bodySelectors) {
      try {
        const els = doc.querySelectorAll(s);
        for (const el of els) {
          results.push({ el, selector: s, source });
        }
      } catch (e) {}
    }
    // 兜底：所有 contenteditable
    try {
      const all = doc.querySelectorAll('[contenteditable="true"]');
      for (const el of all) {
        results.push({ el, selector: '[contenteditable="true"]', source });
      }
    } catch (e) {}
    return results;
  }

  function findWechatEditor(maxRetries) {
    maxRetries = maxRetries || 5;
    function tryFind() {
      const candidates = [];

      // 1. 主文档
      candidates.push(...findEditorsInDoc(document, 'main'));

      // 2. iframe 内文档
      for (const iframe of document.querySelectorAll('iframe')) {
        try {
          const idoc = iframe.contentDocument || iframe.contentWindow.document;
          if (idoc) candidates.push(...findEditorsInDoc(idoc, 'iframe'));
        } catch (e) {}
      }

      // 3. shadow DOM 内
      function walkShadow(node, depth) {
        if (depth > 5) return;
        for (const child of node.querySelectorAll('*')) {
          if (child.shadowRoot) {
            candidates.push(...findEditorsInDoc(child.shadowRoot, 'shadow'));
            walkShadow(child.shadowRoot, depth + 1);
          }
        }
      }
      walkShadow(document, 0);

      if (candidates.length === 0) return null;

      // 去重（同一元素可能通过多个选择器匹配）
      const seen = new Set();
      const unique = [];
      for (const c of candidates) {
        if (!seen.has(c.el)) {
          seen.add(c.el);
          unique.push(c);
        }
      }

      console.log('[GZHMD] found', unique.length, 'editor candidates:');
      for (const c of unique) {
        const r = c.el.getBoundingClientRect();
        console.log('  -', c.source, c.selector, c.el.tagName, 'area=' + Math.round(r.width * r.height), 'id=' + c.el.id, 'class=' + c.el.className.slice(0, 60));
      }

      // 优先选择面积最大且包含 data-placeholder 的元素
      const withPlaceholder = unique.filter(c => c.el.getAttribute('data-placeholder'));
      const pool = withPlaceholder.length > 0 ? withPlaceholder : unique;

      let best = null, bestArea = 0;
      for (const c of pool) {
        const r = c.el.getBoundingClientRect();
        const area = r.width * r.height;
        if (area > bestArea) {
          bestArea = area;
          best = c.el;
        }
      }
      if (best) console.log('[GZHMD] selected editor:', best.tagName, best.className.slice(0, 60));
      return best;
    }

    let result = tryFind();
    if (result || maxRetries <= 0) return result;

    console.log('[GZHMD] editor not found, retrying...');
    return new Promise((resolve) => {
      let attempts = 0;
      function tick() {
        attempts++;
        result = tryFind();
        if (result || attempts >= maxRetries) {
          resolve(result);
        } else {
          setTimeout(tick, 2000);
        }
      }
      tick();
    });
  }

  function sanitizeHtml(html) {
    const allowedTags = new Set([
      'div', 'p', 'br', 'strong', 'b', 'em', 'i', 'del', 's', 'span',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'a', 'img', 'blockquote', 'pre', 'code',
      'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr'
    ]);
    const allowedAttrs = new Set(['href', 'src', 'alt', 'title', 'style']);
    const parser = new DOMParser();
    const doc = parser.parseFromString('<div>' + html + '</div>', 'text/html');
    const root = doc.body.firstChild;
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        if (!allowedTags.has(tag)) {
          const span = document.createElement('span');
          while (node.firstChild) span.appendChild(node.firstChild);
          node.parentNode.replaceChild(span, node);
          walk(span);
          return;
        }
        for (const attr of Array.from(node.attributes)) {
          const name = attr.name.toLowerCase();
          // 去掉事件属性和危险属性，保留 style 等安全属性
          if (name.startsWith('on') || name === 'srcdoc') {
            node.removeAttribute(attr.name);
          }
        }
      }
      for (const child of Array.from(node.childNodes)) walk(child);
    }
    walk(root);
    return root.innerHTML;
  }

  async function insertHtmlToEditor(html) {
    console.log('[GZHMD] insertHtmlToEditor called');
    let editor = await findWechatEditor();
    if (!editor) {
      console.error('[GZHMD] editor not found');
      alert('未找到公众号编辑器，请确保当前处于图文编辑页面');
      return false;
    }
    console.log('[GZHMD] editor found:', editor.tagName, editor.className);

    if (editor.contentEditable !== 'true') {
      const child = editor.querySelector('[contenteditable="true"]');
      if (child) {
        editor = child;
        console.log('[GZHMD] switched to child contenteditable');
      }
    }

    try {
      html = sanitizeHtml(html);
      console.log('[GZHMD] sanitized html length:', html.length);

      // 聚焦编辑器
      editor.focus();

      // 方案 0: ProseMirror 模拟粘贴（最适配新版公众号编辑器）
      if (editor.classList && editor.classList.contains('ProseMirror')) {
        console.log('[GZHMD] using ProseMirror paste simulation');
        try {
          const dt = new DataTransfer();
          dt.setData('text/html', html);
          dt.setData('text/plain', html.replace(/<[^>]+>/g, ''));
          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt,
          });
          editor.dispatchEvent(pasteEvent);
          console.log('[GZHMD] paste event dispatched with DataTransfer');

          // 额外触发 input 事件确保 ProseMirror 更新
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
          return true;
        } catch (e) {
          console.log('[GZHMD] DataTransfer paste failed:', e.message);
        }
      }

      // 方案 1: execCommand insertHTML
      if (document.queryCommandSupported && document.queryCommandSupported('insertHTML')) {
        const ok = document.execCommand('insertHTML', false, html);
        console.log('[GZHMD] execCommand insertHTML result:', ok);
        if (ok) return true;
      }

      // 方案 2: Selection + Range 直接插入
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        console.log('[GZHMD] cursor set to end of editor');

        const frag = range.createContextualFragment(html);
        range.deleteContents();
        range.insertNode(frag);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        console.log('[GZHMD] inserted via Range');
        return true;
      }

      // 最终兜底
      console.log('[GZHMD] fallback: appendChild');
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      while (wrapper.firstChild) {
        editor.appendChild(wrapper.firstChild);
      }
      return true;
    } catch (e) {
      console.error('[GZHMD] insert error:', e);
      return false;
    }
  }

  function createFloatingButton() {
    if (document.getElementById('gzhmd-fab')) return;

    const fab = document.createElement('div');
    fab.id = 'gzhmd-fab';
    fab.title = '打开 Markdown 编辑器';
    fab.innerHTML = '<span>M</span>';
    document.body.appendChild(fab);

    fab.addEventListener('click', () => {
      toggleEditorPanel();
    });
  }

  function toggleEditorPanel() {
    let panel = document.getElementById('gzhmd-panel');
    if (panel) {
      panel.remove();
      return;
    }

    panel = document.createElement('div');
    panel.id = 'gzhmd-panel';

    const header = document.createElement('div');
    header.id = 'gzhmd-header';
    header.innerHTML = '<span>Markdown 编辑器</span><button id="gzhmd-close">×</button>';

    const iframe = document.createElement('iframe');
    iframe.id = 'gzhmd-iframe';
    iframe.src = EDITOR_URL + '?t=' + Date.now();

    panel.appendChild(header);
    panel.appendChild(iframe);
    document.body.appendChild(panel);

    document.getElementById('gzhmd-close').addEventListener('click', () => {
      panel.remove();
    });

    // 面板拖拽移动
    const headerEl = document.getElementById('gzhmd-header');
    let isDraggingPanel = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    headerEl.style.cursor = 'move';
    headerEl.addEventListener('mousedown', (e) => {
      isDraggingPanel = true;
      dragOffsetX = e.clientX - panel.offsetLeft;
      dragOffsetY = e.clientY - panel.offsetTop;
      panel.style.transition = 'none';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDraggingPanel) return;
      let nx = e.clientX - dragOffsetX;
      let ny = e.clientY - dragOffsetY;
      const maxX = window.innerWidth - panel.offsetWidth;
      const maxY = window.innerHeight - panel.offsetHeight;
      nx = Math.max(0, Math.min(nx, maxX));
      ny = Math.max(0, Math.min(ny, maxY));
      panel.style.left = nx + 'px';
      panel.style.top = ny + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    window.addEventListener('mouseup', () => {
      if (isDraggingPanel) {
        isDraggingPanel = false;
        panel.style.transition = '';
      }
    });

    // 监听编辑器发来的消息
    const messageHandler = async (event) => {
      if (event.source !== iframe.contentWindow) return;
      if (!event.data || !event.data.type) return;

      if (event.data.type === 'GZHMD_INSERT') {
        const ok = await insertHtmlToEditor(event.data.html);
        if (ok) {
          iframe.contentWindow.postMessage({ type: 'GZHMD_INSERT_OK' }, '*');
          // 插入成功后关闭面板
          const p = document.getElementById('gzhmd-panel');
          if (p) p.remove();
        } else {
          iframe.contentWindow.postMessage({ type: 'GZHMD_INSERT_FAIL' }, '*');
        }
      }

      if (event.data.type === 'GZHMD_COPY') {
        // 优先使用 WeMD 方式：在内存 DOM 中渲染后 execCommand 复制富文本
        const copied = copyRichHtml(event.data.html);
        if (copied) {
          iframe.contentWindow.postMessage({ type: 'GZHMD_COPY_OK' }, '*');
        } else {
          // fallback 到纯文本复制
          fallbackCopy(event.data.html, iframe);
        }
      }
    };

    window.addEventListener('message', messageHandler);

    // 面板关闭时移除监听器
    const observer = new MutationObserver(() => {
      if (!document.getElementById('gzhmd-panel')) {
        window.removeEventListener('message', messageHandler);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
  }

  // WeMD 方式：在内存中渲染带样式的 DOM，通过 execCommand('copy') 复制富文本
  function copyRichHtml(html) {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '-9999px';
    container.style.width = '760px';
    container.style.opacity = '0';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '-1';
    // 强制亮色模式，防止暗色主题下 execCommand 序列化出亮色文字
    container.style.colorScheme = 'light';
    container.style.color = '#000000';
    container.innerHTML = html;
    document.body.appendChild(container);

    let copied = false;
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(container);
      selection?.removeAllRanges();
      selection?.addRange(range);
      try {
        copied = document.execCommand('copy');
      } finally {
        selection?.removeAllRanges();
      }
    } catch (e) {
      console.error('[GZHMD] execCommand copy failed:', e);
    } finally {
      document.body.removeChild(container);
    }
    return copied;
  }

  function fallbackCopy(text, iframe) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      iframe.contentWindow.postMessage({ type: 'GZHMD_COPY_OK' }, '*');
    } catch (e) {
      iframe.contentWindow.postMessage({ type: 'GZHMD_COPY_FAIL' }, '*');
    }
    document.body.removeChild(ta);
  }

  function init() {
    if (!isEditPage()) return;
    createFloatingButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  function onRouteChange() {
    const oldPanel = document.getElementById('gzhmd-panel');
    if (oldPanel) oldPanel.remove();
    const oldFab = document.getElementById('gzhmd-fab');
    if (oldFab) oldFab.remove();
    window.__gzhmd_injected = false;
    setTimeout(() => {
      window.__gzhmd_injected = false;
      init();
    }, 1000);
  }
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    onRouteChange();
  };
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    onRouteChange();
  };
  window.addEventListener('popstate', onRouteChange);
})();
