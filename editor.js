(function () {
  'use strict';
  console.log('[GZHMD] editor.js loading');

  const mdInput = document.getElementById('md-input');
  const preview = document.getElementById('preview');
  const statusMsg = document.getElementById('status-msg');
  const wordCount = document.getElementById('word-count');
  const inputPane = document.getElementById('input-pane');
  const previewThemeSelect = document.getElementById('preview-theme');
  const STORAGE_KEY = '__gzhmd_draft';
  const PREVIEW_THEME_KEY = '__gzhmd_preview_theme';

  // ===== Markdown Parser =====
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function parseInline(text, mode) {
    const isExport = mode === 'export';
    text = escapeHtml(text);
    const codePlaceholders = [];
    text = text.replace(/`([^`]+)`/g, function(match, code) {
      const id = codePlaceholders.length;
      if (isExport) {
        codePlaceholders.push('<code style="background:#f2f2f2;padding:2px 4px;border-radius:3px;font-family:monospace;font-size:14px;color:#c7254e;word-break:break-word;">' + code + '</code>');
      } else {
        codePlaceholders.push('<code>' + code + '</code>');
      }
      return '§§GZHMD' + id + '§§';
    });
    text = text.replace(/!\[([^\]]*)\]\(([^\)]+)\)/g, isExport
      ? '<img src="$2" alt="$1" style="max-width:100%;height:auto;display:block;margin:12px 0;border-radius:4px;">'
      : '<img src="$2" alt="$1">');
    text = text.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, isExport
      ? '<a href="$2" style="color:#576b95;text-decoration:none;">$1</a>'
      : '<a href="$2">$1</a>');
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, isExport
      ? '<strong style="font-weight:700;color:#000;"><em>$1</em></strong>'
      : '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*([^*]+)\*\*/g, isExport
      ? '<strong style="font-weight:700;color:#000;">$1</strong>'
      : '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, isExport
      ? '<em style="font-style:italic;">$1</em>'
      : '<em>$1</em>');
    text = text.replace(/_([^_]+)_/g, isExport
      ? '<em style="font-style:italic;">$1</em>'
      : '<em>$1</em>');
    text = text.replace(/~~([^~]+)~~/g, isExport
      ? '<del style="text-decoration:line-through;">$1</del>'
      : '<del>$1</del>');
    text = text.replace(/§§GZHMD(\d+)§§/g, function(match, id) {
      return codePlaceholders[+id];
    });
    return text;
  }

  function parseListRef(lines, baseIndent, type, isNested, mode) {
    const isExport = mode === 'export';
    let html = isExport
      ? `<${type} style="margin:${isNested ? '6px 0 0' : '0 0 20px'};padding-left:20px;line-height:1.75;font-size:16px;">\n`
      : `<${type}>\n`;
    const marker = type === 'ul' ? /^\s*[-*+]\s+/ : /^\s*\d+\.\s+/;
    const anyListMarker = /^\s*(?:[-*+]|\d+\.)\s+/;
    while (lines.length > 0) {
      const line = lines[0];
      const indent = (line.match(/^(\s*)/) || ['', ''])[1].length;
      if (indent < baseIndent || (indent === baseIndent && !marker.test(line))) break;

      if (indent > baseIndent) {
        const subType = /^\s*[-*+]\s+/.test(line) ? 'ul' : 'ol';
        const subHtml = parseListRef(lines, indent, subType, true, mode);
        html = html.replace(/<\/li>\s*$/, '') + subHtml + '</li>\n';
        continue;
      }

      const content = line.replace(marker, '');
      lines.shift();
      const bodyLines = [content];
      while (lines.length > 0) {
        const next = lines[0];
        const nextIndent = (next.match(/^(\s*)/) || ['', ''])[1].length;
        const isBlank = /^\s*$/.test(next);

        if (isBlank) {
          let j = 1;
          while (j < lines.length && /^\s*$/.test(lines[j])) j++;
          let endHere = false;
          if (j < lines.length) {
            const afterIndent = (lines[j].match(/^(\s*)/) || ['', ''])[1].length;
            if (afterIndent < baseIndent) endHere = true;
            if (afterIndent === baseIndent && anyListMarker.test(lines[j])) endHere = true;
            if (afterIndent === baseIndent && /^(#{1,6}\s|```|>|\||---|___|\*\*\*)/.test(lines[j])) endHere = true;
          } else {
            endHere = true;
          }
          if (endHere) break;
          bodyLines.push('');
          lines.shift();
          continue;
        }

        if (nextIndent > baseIndent && anyListMarker.test(next)) {
          break;
        }

        if (nextIndent < baseIndent) break;
        if (nextIndent === baseIndent && anyListMarker.test(next)) break;
        if (nextIndent === baseIndent && /^(#{1,6}\s|```|>|\||---|___|\*\*\*)/.test(next)) break;
        bodyLines.push(next.trim());
        lines.shift();
      }
      const bodyText = bodyLines.join(' ');
      html += isExport
        ? `<li style="margin-bottom:6px;">${parseInline(bodyText, mode)}</li>\n`
        : `<li>${parseInline(bodyText, mode)}</li>\n`;
    }
    return html + `</${type}>\n`;
  }

  function parseTable(lines, mode) {
    const isExport = mode === 'export';
    const header = lines.shift().trim();
    lines.shift();
    const cells = [];
    while (lines.length > 0 && /^\|/.test(lines[0])) {
      cells.push(lines.shift().trim());
    }
    const parseRow = (row) => row.split('|').map(s => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1 || (arr.length === 2 && idx === 1));
    const heads = parseRow(header);
    let html = isExport
      ? '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">\n<thead>\n<tr>\n'
      : '<table>\n<thead>\n<tr>\n';
    for (const h of heads) {
      html += isExport
        ? `<th style="border:1px solid #ddd;padding:8px 12px;text-align:left;background:#f5f5f5;font-weight:600;">${parseInline(h, mode)}</th>\n`
        : `<th>${parseInline(h, mode)}</th>\n`;
    }
    html += '</tr>\n</thead>\n<tbody>\n';
    let rowIdx = 0;
    for (const row of cells) {
      const cols = parseRow(row);
      const bg = rowIdx % 2 === 1 ? 'background:#fafafa;' : '';
      html += isExport ? `<tr style="${bg}">\n` : '<tr>\n';
      for (const c of cols) {
        html += isExport
          ? `<td style="border:1px solid #ddd;padding:8px 12px;text-align:left;">${parseInline(c, mode)}</td>\n`
          : `<td>${parseInline(c, mode)}</td>\n`;
      }
      html += '</tr>\n';
      rowIdx++;
    }
    html += '</tbody>\n</table>\n';
    return html;
  }

  function parseMarkdown(src, mode) {
    const isExport = mode === 'export';
    const lines = src.replace(/\r\n/g, '\n').split('\n');
    let html = '';

    function flushParagraph(buf) {
      if (!buf.length) return '';
      const text = buf.join(' ').trim();
      if (!text) return '';
      return isExport
        ? '<p style="margin:0 0 20px;line-height:1.75;clear:both;">' + parseInline(text, mode) + '</p>'
        : '<p>' + parseInline(text, mode) + '</p>';
    }

    while (lines.length > 0) {
      let line = lines[0];

      if (/^\s*$/.test(line)) {
        lines.shift();
        continue;
      }

      if (/^(---|___|\*\*\*)\s*$/.test(line)) {
        html += isExport
          ? '<hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0;">\n'
          : '<hr>\n';
        lines.shift();
        continue;
      }

      const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (hMatch) {
        const level = hMatch[1].length;
        if (isExport) {
          const sizes = ['20px', '18px', '16px', '15px', '14px', '14px'];
          const mts = ['24px', '22px', '20px', '18px', '16px', '16px'];
          const mbs = ['12px', '10px', '8px', '6px', '4px', '4px'];
          html += `<h${level} style="margin-top:${mts[level-1]};margin-bottom:${mbs[level-1]};font-weight:700;line-height:1.4;color:#000;font-size:${sizes[level-1]};">${parseInline(hMatch[2], mode)}</h${level}>\n`;
        } else {
          html += `<h${level}>${parseInline(hMatch[2], mode)}</h${level}>\n`;
        }
        lines.shift();
        continue;
      }

      const cbMatch = line.match(/^```(\w*)\s*$/);
      if (cbMatch) {
        lines.shift();
        const codeLines = [];
        while (lines.length > 0 && !/^```\s*$/.test(lines[0])) {
          codeLines.push(lines.shift());
        }
        if (lines.length > 0) lines.shift();
        const code = escapeHtml(codeLines.join('\n'));
        if (isExport) {
          html += `<pre style="background:#f8f8f8;border:1px solid #e8e8e8;border-radius:4px;padding:12px 16px;overflow-x:auto;margin:0 0 20px;word-wrap:normal;"><code style="background:none;padding:0;color:#333;font-family:monospace;font-size:13px;line-height:1.6;word-break:normal;white-space:pre;">${code}</code></pre>\n`;
        } else {
          html += `<pre><code>${code}</code></pre>\n`;
        }
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quoteLines = [];
        while (lines.length > 0 && /^>\s?/.test(lines[0])) {
          quoteLines.push(lines.shift().replace(/^>\s?/, ''));
        }
        let qhtml = '';
        let qbuf = [];
        for (const ql of quoteLines) {
          if (/^\s*$/.test(ql)) {
            qhtml += flushParagraph(qbuf);
            qbuf = [];
          } else {
            qbuf.push(ql);
          }
        }
        qhtml += flushParagraph(qbuf);
        if (isExport) {
          html += `<blockquote style="margin:16px 0;padding:10px 16px;border-left:4px solid #dfdfdf;background:#f7f7f7;color:#888;font-size:15px;line-height:1.7;">${qhtml}</blockquote>\n`;
        } else {
          html += `<blockquote>${qhtml}</blockquote>\n`;
        }
        continue;
      }

      if (/^(\s*)[-*+]\s+/.test(line)) {
        html += parseListRef(lines, 0, 'ul', false, mode);
        continue;
      }

      if (/^(\s*)\d+\.\s+/.test(line)) {
        html += parseListRef(lines, 0, 'ol', false, mode);
        continue;
      }

      if (/^\|/.test(line) && lines.length > 1 && /^\|[\s|:-]+\|/.test(lines[1])) {
        html += parseTable(lines, mode);
        continue;
      }

      const pLines = [];
      while (lines.length > 0) {
        const l = lines[0];
        if (/^\s*$/.test(l)) break;
        if (/^(#{1,6}\s|```|>|\s*[-*+]\s+|\s*\d+\.\s+|---|___|\*\*\*|\|)/.test(l)) break;
        pLines.push(lines.shift());
      }
      html += flushParagraph(pLines);
    }

    if (isExport) {
      return `<div style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:1.75;color:#333;word-wrap:break-word;">${html}</div>`;
    }
    return `<div class="gzhmd-content">${html}</div>`;
  }

  function renderPreview(src) {
    return parseMarkdown(src, 'preview');
  }

  function generateExportHtml(src) {
    return parseMarkdown(src, 'export');
  }

  // ===== Theme Management =====
  function setPreviewTheme(theme) {
    preview.className = theme;
    localStorage.setItem(PREVIEW_THEME_KEY, theme);
    if (previewThemeSelect) previewThemeSelect.value = theme;
  }

  function loadThemes() {
    const previewTheme = localStorage.getItem(PREVIEW_THEME_KEY) || 'theme-default';
    setPreviewTheme(previewTheme);
  }

  // ===== Editor Logic =====
  function updatePreview() {
    const src = mdInput.value;
    console.log('[GZHMD] updatePreview called, src length:', src.length);
    try {
      const html = renderPreview(src);
      preview.innerHTML = html;
      console.log('[GZHMD] renderPreview ok, html length:', html.length);
    } catch (e) {
      console.error('[GZHMD] renderPreview error:', e);
    }
    const text = src.replace(/\s/g, '');
    wordCount.textContent = text.length + ' 字';
    saveDraft();
  }

  function saveDraft() {
    try {
      localStorage.setItem(STORAGE_KEY, mdInput.value);
    } catch (e) {}
  }

  const DEFAULT_CONTENT = `# 标题\n\n**粗体** *斜体* \`代码\`\n\n- 列表项\n- 列表项\n\n> 引用\n\n| 表头 | 表头 |\n|------|------|\n| 内容 | 内容 |\n`;

  function loadDraft() {
    try {
      const draft = localStorage.getItem(STORAGE_KEY);
      if (draft !== null && draft !== '') {
        mdInput.value = draft;
      } else {
        mdInput.value = DEFAULT_CONTENT;
      }
      updatePreview();
    } catch (e) {}
  }

  function showToast(msg, type) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  function insertText(text) {
    const start = mdInput.selectionStart;
    const end = mdInput.selectionEnd;
    const val = mdInput.value;
    mdInput.value = val.substring(0, start) + text + val.substring(end);
    mdInput.selectionStart = mdInput.selectionEnd = start + text.length;
    mdInput.focus();
    updatePreview();
  }

  function wrapText(before, after) {
    const start = mdInput.selectionStart;
    const end = mdInput.selectionEnd;
    const val = mdInput.value;
    const selected = val.substring(start, end);
    const replacement = before + selected + after;
    mdInput.value = val.substring(0, start) + replacement + val.substring(end);
    mdInput.selectionStart = start + before.length;
    mdInput.selectionEnd = start + before.length + selected.length;
    mdInput.focus();
    updatePreview();
  }

  // Toolbar handlers
  document.querySelectorAll('#toolbar button[data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      switch (cmd) {
        case 'h1': insertText('\n# '); break;
        case 'h2': insertText('\n## '); break;
        case 'h3': insertText('\n### '); break;
        case 'bold': wrapText('**', '**'); break;
        case 'italic': wrapText('*', '*'); break;
        case 'code': wrapText('`', '`'); break;
        case 'pre': insertText('\n```\n\n```\n'); break;
        case 'link': {
          const url = prompt('请输入链接地址:', 'https://');
          if (url) wrapText('[', '](' + url + ')');
          break;
        }
        case 'image': {
          const imgUrl = prompt('请输入图片地址:');
          if (imgUrl) insertText('\n![](' + imgUrl + ')\n');
          break;
        }
        case 'quote': insertText('\n> '); break;
        case 'ul': insertText('\n- '); break;
        case 'ol': insertText('\n1. '); break;
        case 'hr': insertText('\n---\n'); break;
        case 'table':
          insertText('\n| 标题 | 标题 |\n|------|------|\n| 内容 | 内容 |\n');
          break;
      }
    });
  });

  // Theme switches
  if (previewThemeSelect) {
    previewThemeSelect.addEventListener('change', (e) => {
      setPreviewTheme(e.target.value);
    });
  }

  // Preview-only toggle
  let previewOnly = false;
  document.getElementById('btn-preview-only').addEventListener('click', () => {
    previewOnly = !previewOnly;
    const previewPane = document.getElementById('preview-pane');
    if (previewOnly) {
      inputPane.style.display = 'none';
      previewPane.style.flex = 'none';
      previewPane.style.width = '100%';
    } else {
      inputPane.style.display = 'flex';
      previewPane.style.flex = '1';
      previewPane.style.width = '';
    }
  });

  // Insert to WeChat
  document.getElementById('btn-insert').addEventListener('click', () => {
    const html = generateExportHtml(mdInput.value);
    if (!html.trim()) {
      showToast('内容为空', 'error');
      return;
    }
    window.parent.postMessage({ type: 'GZHMD_INSERT', html }, '*');
    statusMsg.textContent = '正在插入...';
  });

  // Listen for responses from content script
  window.addEventListener('message', (event) => {
    if (!event.data || !event.data.type) return;
    if (event.data.type === 'GZHMD_INSERT_OK') {
      showToast('已插入到公众号编辑器', 'success');
      statusMsg.textContent = '插入成功';
    } else if (event.data.type === 'GZHMD_INSERT_FAIL') {
      showToast('插入失败，未找到编辑器', 'error');
      statusMsg.textContent = '插入失败';
    }
  });

  // Import / Export
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      mdInput.value = ev.target.result;
      updatePreview();
      showToast('已导入: ' + file.name, 'success');
    };
    reader.readAsText(file);
    e.target.value = '';
  });
  document.getElementById('btn-export').addEventListener('click', () => {
    const blob = new Blob([mdInput.value], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'article.md';
    a.click();
    URL.revokeObjectURL(url);
    showToast('已导出 article.md', 'success');
  });

  // Reward modal
  const btnReward = document.getElementById('btn-reward');
  const rewardModal = document.getElementById('reward-modal');
  const rewardClose = document.querySelector('.reward-close');
  if (btnReward && rewardModal) {
    btnReward.addEventListener('click', () => {
      rewardModal.classList.remove('hidden');
    });
  }
  if (rewardClose && rewardModal) {
    rewardClose.addEventListener('click', () => {
      rewardModal.classList.add('hidden');
    });
  }
  if (rewardModal) {
    rewardModal.querySelector('.reward-overlay').addEventListener('click', () => {
      rewardModal.classList.add('hidden');
    });
  }

  // Input events
  mdInput.addEventListener('input', updatePreview);

  // Keyboard shortcuts
  mdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      insertText('  ');
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    switch (e.key.toLowerCase()) {
      case 'b':
        e.preventDefault();
        wrapText('**', '**');
        break;
      case 'i':
        e.preventDefault();
        wrapText('*', '*');
        break;
      case 'k':
        e.preventDefault();
        if (mdInput.selectionStart !== mdInput.selectionEnd) {
          wrapText('[', '](https://)');
        } else {
          insertText('[链接](https://)');
        }
        break;
      case 'enter':
        e.preventDefault();
        document.getElementById('btn-insert').click();
        break;
      case 's':
        e.preventDefault();
        saveDraft();
        showToast('已保存草稿', 'success');
        break;
    }
  });

  // Resizer drag
  const resizer = document.getElementById('resizer');
  const editorArea = document.getElementById('editor-area');
  let isDragging = false;
  if (resizer && editorArea) {
    resizer.addEventListener('mousedown', (e) => {
      isDragging = true;
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const rect = editorArea.getBoundingClientRect();
      const newWidth = e.clientX - rect.left;
      const minWidth = 100;
      const maxWidth = rect.width - minWidth - 6;
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        inputPane.style.flex = 'none';
        inputPane.style.width = newWidth + 'px';
      }
    });
    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  // Init
  console.log('[GZHMD] editor.js init start');
  loadThemes();
  loadDraft();
  console.log('[GZHMD] editor.js init done');
})();
