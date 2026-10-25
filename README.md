# GPT Batch Manager

![GPT Batch Manager logo](icons/icon-128.png)

[中文](#中文) · [English](#english)

## 中文

轻量化的 Chrome / Edge 扩展，在 ChatGPT 网页侧栏选择并批量管理对话。

### 功能

- 在已显示的对话前添加复选框。
- “全选未归档”按页读取账号中的未归档对话，包括尚未出现在侧栏的对话；读取不完整时不会提交部分选择。
- 批量删除、归档，最多同时处理 4 个请求。成功后立即从侧栏隐藏对应条目；失败项保持勾选。
- 将选中对话的标题、ID 和链接导出为 JSON。导出文件**不包含对话正文**。
- 通过 ChatGPT 原生菜单移动已显示在侧栏的对话。尚未显示的对话暂不支持移动。

### 安装

1. 下载或克隆本仓库。
2. 打开 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions`，开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的文件夹。
4. 打开或刷新 [ChatGPT](https://chatgpt.com/)。

### 使用

勾选侧栏中的对话，或点击“全选未归档”，然后选择“归档”“移动”“导出”或“删除”。删除前会再次确认。全选读取期间会显示进度，可点击 × 取消。

### 注意

删除、归档和列出全部对话使用 ChatGPT 网页的非公开接口，可能随网站更新而失效；移动依赖网页菜单结构。扩展只向当前 ChatGPT 网站发送请求，登录令牌仅保存在当前页面的内存中。删除是不可撤销的操作，建议先用少量不需要的对话测试。

## English

A lightweight Chrome / Edge extension for selecting and managing ChatGPT conversations in batches from the web sidebar.

### Features

- Adds a checkbox to each conversation rendered in the sidebar.
- **Select all unarchived** paginates through the account's unarchived conversations, including those not yet rendered in the sidebar. An incomplete fetch never becomes a partial “select all.”
- Deletes or archives in batches with up to four concurrent requests. Successful items disappear from the sidebar immediately; failed items remain selected.
- Exports selected conversation titles, IDs, and URLs as JSON. The export **does not include message content**.
- Moves conversations through ChatGPT's native menu. This currently works only for conversations rendered in the sidebar.

### Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge and enable Developer mode.
3. Choose **Load unpacked** and select the folder containing `manifest.json`.
4. Open or refresh [ChatGPT](https://chatgpt.com/).

### Use

Select conversations in the sidebar, or click **全选未归档** (Select all unarchived), then choose **归档** (Archive), **移动** (Move), **导出** (Export), or **删除** (Delete). Deletion requires confirmation. The select-all operation shows progress and can be cancelled with ×.

### Notes

Listing, deleting, and archiving rely on ChatGPT's undocumented web endpoints and may break when the site changes. Moving relies on its menu structure. Requests go only to the current ChatGPT site; the session token stays in page memory. Deletion cannot be undone, so test with a few expendable conversations first.
