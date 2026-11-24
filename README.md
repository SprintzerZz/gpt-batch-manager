# GPT Batch Manager

<p align="center">
  <img src="icons/icon-128.png" alt="GPT Batch Manager logo" width="128">
</p>

<p align="center">
  <a href="#中文">中文</a> · <a href="#english">English</a>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/gpt-batch-manager/helnomgghmpdbdpofklcpcidaijbceag">Chrome 网上应用店 / Chrome Web Store</a>
</p>

<p align="center">
  <img src="store-assets/ui-showcase.png" alt="GPT Batch Manager v0.2.29 Dual-Mode UI Showcase" width="100%">
</p>

## 中文

GPT Batch Manager 是一款轻量的 Chrome / Edge 扩展。在 ChatGPT 侧栏勾选多条对话，即可批量归档、删除、移动到项目或导出列表。

### v0.2.29 更新内容

- **双模式 UI 与专属配色体系**：点击扩展图标即可在 **复古模式** 与 **现代模式** 之间自由切换，并即时同步到当前 ChatGPT 标签页：
  - **复古模式（统一纸墨档案结构）**：提供 **纸墨档案**（默认，米白羊皮纸 / 深胡桃木 + 陶土红 / 暖铜）、**经典桌面**（暖米灰 + 经典海军蓝）、**琥珀仪器**（暖琥珀纸 / 深黑炭 + 琥珀金微光）3 套专属配色。
  - **现代模式（毛玻璃通透风）**：提供 **极简黑白**（默认，原生融入 ChatGPT 暗/亮色）、**科技蓝**（Linear 风格清爽蓝）、**静谧紫**（现代 AI 质感微靛紫）3 套专属配色。
- **全组件暗色 / 亮色自适应**：自动检测并实时跟随 ChatGPT 网页明暗主题，移除旧版硬编码绿色与刺眼纯白弹窗。
- **侧栏选中与项目标签美化**：升级为自定义 SVG 复选框（修复项目对话勾选后对勾消失的问题），选中态覆盖完整侧栏行并附带左侧指示条；复古模式采用方角框框项目标签，现代模式采用柔和圆角胶囊标签。
- **悬浮工具栏与项目选择器升级**：操作按钮新增极简线性图标，项目选择器新增搜索图标、`ESC` 键帽提示与与侧栏一致的项目彩色圆点，Toast 提示增加对勾图标与平滑过渡动画。
- **扩展设置弹窗升级**：弹窗界面随所选模式与配色实时换肤，并分别记忆复古与现代模式下各自上次使用的配色。

### 功能

- **批量选择**：逐条勾选，或使用「全选未归档」，一次选中所有未归档对话，包括尚未加载到侧栏的条目。
- **归档与删除**：批量归档或删除所选对话。确认删除后，对话会先从侧栏隐藏，删除失败的条目会恢复显示并保留勾选。
- **整理项目**：将侧栏中支持移动的对话批量移入已有项目，通过彩色标签辨认对话所属项目。
- **导出列表**：将所选对话的标题、链接和 ID 保存为 JSON，文件不包含对话正文。
- **主题与语言设置**：点击工具栏中的扩展图标，自由切换 **复古 / 现代** 模式、专属配色以及 **简体中文 / English** 界面语言，浏览器会自动记住你的选择。

### 安装

Chrome 用户可直接从 [Chrome 网上应用店](https://chromewebstore.google.com/detail/gpt-batch-manager/helnomgghmpdbdpofklcpcidaijbceag)安装。也可以手动安装本地版本：

1. 下载或克隆本仓库。
2. 打开 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions`，开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的文件夹。
4. 打开或刷新 [ChatGPT](https://chatgpt.com/)。

### 使用

点击浏览器工具栏中的 GPT Batch Manager 图标，可以切换界面模式（复古 / 现代）、专属配色方案以及界面语言（简体中文 / English），设置会保存在当前浏览器中并实时应用到已打开的 ChatGPT 标签页。

勾选侧栏中的对话，或点击“全选未归档”，然后选择“归档”“移动”“导出”或“删除”。点击“移动”后，在弹窗中搜索并选择左侧项目；本次批量移动都会使用该项目。删除前会再次确认；确认后请保持 ChatGPT 页面打开，等待后台删除结果和失败项恢复。全选读取期间会显示进度，可点击 × 取消。

### 注意

删除、归档、列出全部对话和折叠项目的标签识别使用 ChatGPT 网页的非公开接口，可能随网站更新而失效；移动依赖网页菜单或拖放结构。折叠项目标签查询若返回 401/403，本页会停止重试；无法直接识别项目归属的“最近”对话可能不显示标签。标签识别使用项目名称和对话 ID，不请求对话正文。扩展只向当前 ChatGPT 网站发送请求，登录令牌仅保存在当前页面的内存中。删除是不可撤销的操作，建议先用少量不需要的对话测试。

扩展使用当前 ChatGPT 登录状态，无需另行注册。对话数据不会发送到开发者服务器。[隐私政策](PRIVACY.md)

## English

GPT Batch Manager is a lightweight Chrome and Edge extension for organizing ChatGPT conversations. Select multiple chats directly in the sidebar to archive or delete them, move them to a project, or export a list.

### What's New in v0.2.29

- **Dual-Mode UI & Dedicated Palettes**: Switch between **Retro** and **Modern** modes directly from the extension popup with instant sync to open ChatGPT tabs:
  - **Retro Mode (Unified Warm Paper layout)**: **Paper** (default, warm parchment / deep walnut + terracotta), **Retro Mac** (warm gray + classic navy blue), and **Amber** (warm amber / charcoal + amber glow).
  - **Modern Mode (Frosted Glass UI)**: **Mono** (default, native monochrome matching ChatGPT), **Tech Blue** (crisp Linear-style blue), and **Indigo** (subtle AI-inspired violet).
- **Full Light & Dark Theme Sync**: Automatically follows ChatGPT's active light/dark theme across the floating dock, project picker modal, checkboxes, tags, and toasts—replacing the legacy hardcoded green palette.
- **Refined Sidebar Selection & Project Tags**: Custom inline-SVG checkboxes (fixing disappearing checkmarks inside project folders), full-row selection highlight with accent bar, framed retro project tags in Retro mode, and soft pill tags in Modern mode.
- **Upgraded Floating Dock & Project Picker**: Minimalist SVG icons on all batch action buttons, command-palette style project picker with search icon, `ESC` badge, and color-matched project dots, plus animated toast notifications.
- **Live-Themed Popup**: The extension popup adapts in real time to your chosen mode and palette and remembers your last selected palette per mode.

### Features

- **Select chats in bulk**. Pick individual conversations or use **Select all unarchived** to include chats that haven’t loaded in the sidebar yet.
- **Archive or delete chats**. After you confirm deletion, selected chats disappear from the sidebar. If a deletion fails, the chat reappears and stays selected.
- **Organize with projects**. Move eligible chats visible in the sidebar into an existing project. Color-coded labels show project membership where it can be identified.
- **Export a chat list**. Save titles, links, and IDs as a JSON file. Message content is excluded.
- **Appearance & language settings**. Click the extension icon in your browser toolbar to switch between Retro / Modern styles, curated accent palettes, and English / Simplified Chinese. Your browser remembers your choices.

### Install

Chrome users can install directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/gpt-batch-manager/helnomgghmpdbdpofklcpcidaijbceag). To install a local copy instead:

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge and enable Developer mode.
3. Choose **Load unpacked** and select the folder containing `manifest.json`.
4. Open or refresh [ChatGPT](https://chatgpt.com/).

### Use

Click the GPT Batch Manager toolbar icon to switch interface mode (Retro / Modern), palette, and language (Simplified Chinese / English). Settings are saved locally and applied immediately to the active ChatGPT tab.

Select conversations in the sidebar, or click **全选未归档** (Select all unarchived), then choose **归档** (Archive), **移动** (Move), **导出** (Export), or **删除** (Delete). After clicking Move, choose a destination in the project picker; the whole batch uses that project. Deletion requires confirmation; keep the ChatGPT page open until the background result and any rollback appear. The select-all operation shows progress and can be cancelled with ×.

### Notes

Listing, deleting, archiving, and resolving labels for collapsed projects rely on ChatGPT's undocumented web endpoints and may break when the site changes. If collapsed-project label lookup returns 401/403, the extension stops retrying on that page; Recents chats whose project cannot be inferred locally may have no label. Moving relies on the site's menu or drag-and-drop structure. Label lookup uses project names and conversation IDs, without requesting message content. Requests go only to the current ChatGPT site; the session token stays in page memory. Deletion cannot be undone, so test with a few expendable conversations first.

The extension uses your existing ChatGPT sign-in and requires no separate account. Conversation data is never sent to the developer’s servers. [Privacy Policy](PRIVACY.md)
