# WxMdExtension

微信公众号 Markdown 编辑器扩展，让你在公众号图文编辑页面也能享受流畅的 Markdown 写作体验。

## 功能特性

- **实时预览**：左侧输入 Markdown，右侧实时渲染公众号风格排版
- **一键插入**：编辑完成后一键插入到公众号编辑器
- **多主题切换**：支持微信排版、极简、优雅、WeMD 莫兰迪/黑金/学术等多种主题
- **快捷导入/导出**：支持导入 `.md` / `.markdown` / `.txt` 文件，或导出为 Markdown
- **常用语法工具栏**：H1-H3、粗体、斜体、代码、链接、图片、引用、列表、表格、分割线等快捷按钮
- **自动保存草稿**：本地自动保存，刷新不丢失
- **拖拽调整分栏**：支持拖拽调整编辑区与预览区宽度

## 安装

1. 下载本项目并解压
2. 打开 Chrome 浏览器，进入 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择 `wechat-mp-markdown` 文件夹

## 使用

1. 登录[微信公众平台](https://mp.weixin.qq.com/)
2. 进入「内容与互动」→「草稿箱」→「写新图文」
3. 点击页面右下角的 **M** 按钮打开 Markdown 编辑器
4. 在左侧输入 Markdown，右侧实时预览
5. 编辑完成后点击「插入到公众号」即可

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl/Cmd + B` | 粗体 |
| `Ctrl/Cmd + I` | 斜体 |
| `Ctrl/Cmd + K` | 插入链接 |
| `Ctrl/Cmd + Enter` | 插入到公众号 |
| `Ctrl/Cmd + S` | 保存草稿 |
| `Tab` | 插入两个空格 |

## 项目结构

```
wechat-mp-markdown/
├── manifest.json   # 扩展配置
├── content.js      # 内容脚本，注入编辑器到公众号页面
├── content.css     # 内容脚本样式
├── editor.html     # Markdown 编辑器界面
├── editor.js       # 编辑器逻辑（解析、预览、插入）
├── editor.css      # 编辑器样式
├── popup.html      # 扩展图标弹窗
├── zsm.png         # 赞赏码
└── icon*.png       # 扩展图标
```

## 许可证

[MIT](LICENSE)
