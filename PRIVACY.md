# Privacy Policy / 隐私政策

Last updated: 2026-10-25

## 中文

GPT Batch Manager 仅在用户打开的 ChatGPT 网页上运行，用于显示项目标签，以及批量选择、归档、删除、移动和导出对话。

- 扩展会读取 ChatGPT 侧栏中的对话标题、链接和 ID。项目折叠且“最近”中的对话缺少项目标签时，会按需从当前 ChatGPT 网站读取项目名称及对话 ID，不请求对话正文。使用“全选未归档”时，也会通过当前 ChatGPT 网站读取对话列表。
- 归档和删除请求仅发送至用户当前访问的 ChatGPT 网站。移动操作使用网页现有菜单。
- 扩展会临时在当前页面内存中使用 ChatGPT 登录会话令牌，以完成上述请求；不会将令牌存入浏览器存储、导出文件或开发者服务器。
- 用户主动导出时，扩展在本地生成 JSON 文件，其中包含所选对话的标题、ID、链接及导出时间，不包含对话正文。
- 开发者不收集、接收、出售或共享用户数据；扩展没有分析服务、广告或开发者后台。除与 ChatGPT 网站通信及用户主动下载文件外，不向第三方传输数据。

如果你不再希望扩展访问 ChatGPT 页面，可以在浏览器扩展管理页禁用或卸载它；已导出的本地文件需由你自行管理。

隐私问题可通过 [GitHub Issues](https://github.com/SprintzerZz/gpt-batch-manager/issues) 联系项目维护者。

## English

GPT Batch Manager runs only on ChatGPT pages opened by the user. It shows project labels and lets the user select, archive, delete, move, and export conversations in batches.

- It reads conversation titles, links, and IDs from the ChatGPT sidebar. When a project is collapsed and a Recent chat lacks a project label, it may retrieve project names and conversation IDs from the current ChatGPT site without requesting message content. “Select all unarchived” retrieves the conversation list from the current ChatGPT site.
- Archive and delete requests go only to the ChatGPT site the user is visiting. Move uses the site's existing menu.
- A ChatGPT session token is used temporarily in page memory for these requests. It is not saved to browser storage, included in exports, or sent to a developer server.
- When the user chooses Export, the extension creates a local JSON file containing selected conversation titles, IDs, URLs, and export time. Message bodies are not exported.
- The developer does not collect, receive, sell, or share user data. The extension has no analytics, advertising, or developer backend. It sends no data to third parties other than requests to the ChatGPT site and the user's chosen local download.

To stop the extension from accessing ChatGPT pages, disable or uninstall it in your browser's extension settings. You are responsible for any files you exported locally.

For privacy questions, contact the maintainer through [GitHub Issues](https://github.com/SprintzerZz/gpt-batch-manager/issues).
