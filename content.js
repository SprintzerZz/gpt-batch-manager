(function () {
  'use strict';

  const state = {
    selected: new Map(),
    toolbar: null,
    bodyObserver: null,
    sidebarObserver: null,
    sidebar: null,
    decorateTimer: null,
    sidebarTimer: null,
    busy: false,
    accessToken: null,
    tokenPromise: null,
    selectController: null,
    knownAllIds: null,
    hiddenIds: new Set(),
    hiddenRows: new WeakMap()
  };

  // 同时兼容 /c/id 和 https://chatgpt.com/c/id 两种链接形式。
  const SELECTOR = 'a[href*="/c/"]';
  const ORIGIN = window.location.origin;
  const BATCH_CONCURRENCY = 4;
  const LIST_PAGE_SIZE = 100;

  function conversationId(link) {
    return new URL(link.href).pathname.split('/').filter(Boolean).pop();
  }

  function titleOf(link) {
    return (link.innerText || link.textContent || '').replace(/\s+/g, ' ').trim() || 'Untitled conversation';
  }

  function isConversationLink(link) {
    return link.matches(SELECTOR) && Boolean(conversationId(link));
  }

  function ensureToolbar() {
    if (state.toolbar?.isConnected) return state.toolbar;

    const toolbar = document.createElement('div');
    toolbar.className = 'gbm-toolbar';
    toolbar.innerHTML = `
      <div class="gbm-toolbar__top">
        <label class="gbm-select-all"><input type="checkbox" data-gbm-select-all> 全选未归档</label>
        <span class="gbm-count">已选择 0 项</span>
        <button class="gbm-close" type="button" title="取消选择">×</button>
      </div>
      <div class="gbm-actions">
        <button type="button" data-gbm-action="archive">归档</button>
        <button type="button" data-gbm-action="move">移动</button>
        <button type="button" data-gbm-action="export">导出</button>
        <button type="button" class="gbm-danger" data-gbm-action="delete">删除</button>
      </div>
      <div class="gbm-status" role="status" aria-live="polite"></div>`;

    toolbar.querySelector('[data-gbm-select-all]').addEventListener('change', (event) => {
      if (event.target.checked) void selectAllConversations();
      else clearSelection();
    });
    toolbar.querySelector('.gbm-close').addEventListener('click', clearSelection);
    toolbar.querySelectorAll('[data-gbm-action]').forEach((button) => {
      button.addEventListener('click', () => runAction(button.dataset.gbmAction));
    });

    document.body.appendChild(toolbar);
    state.toolbar = toolbar;
    return toolbar;
  }

  function getConversationLinks() {
    return allConversationLinks().filter((link) => !state.hiddenIds.has(conversationId(link)));
  }

  function allConversationLinks() {
    const root = state.sidebar || document;
    return [...root.querySelectorAll(SELECTOR)].filter(isConversationLink);
  }

  function conversationRow(link) {
    const cached = state.hiddenRows.get(link);
    if (cached?.isConnected) return cached;
    let row = link.closest('[data-sidebar-item="true"]') || link;
    const maxHeight = Math.max(64, link.getBoundingClientRect().height * 2);
    // 向外找到完整的列表行，但不要隐藏整个分组或侧边栏。
    for (let level = 0; level < 5; level += 1) {
      const parent = row.parentElement;
      if (!parent || parent.matches('nav, aside') || parent.querySelectorAll(SELECTOR).length !== 1) break;
      if (parent.querySelector('h1, h2, h3, [role="heading"]')) break;
      if (parent.getBoundingClientRect().height > maxHeight) break;
      row = parent;
    }
    state.hiddenRows.set(link, row);
    return row;
  }

  function decorate() {
    allConversationLinks().forEach((link) => {
      const id = conversationId(link);
      if (state.knownAllIds && !state.knownAllIds.has(id) && !state.hiddenIds.has(id)) {
        state.knownAllIds = null;
      }
      if (state.hiddenIds.has(id)) {
        conversationRow(link).classList.add('gbm-hidden');
        return;
      }
      if (link.dataset.gbmReady) return;
      link.dataset.gbmReady = '1';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'gbm-checkbox';
      box.title = '选择此对话';
      box.checked = state.selected.has(id);
      box.addEventListener('click', (event) => event.stopPropagation());
      box.addEventListener('change', () => {
        setStatus('');
        const currentId = conversationId(link);
        if (box.checked) state.selected.set(currentId, { id: currentId, title: titleOf(link), link });
        else state.selected.delete(currentId);
        refresh();
      });
      link.classList.add('gbm-conversation');
      link.prepend(box);
    });
    refresh();
  }

  function refresh() {
    const count = state.selected.size;
    const toolbar = ensureToolbar();
    toolbar.classList.toggle('gbm-toolbar--visible', count > 0 || Boolean(toolbar.querySelector('.gbm-status').textContent));
    toolbar.querySelector('.gbm-count').textContent = `已选择 ${count} 项`;
    const boxes = getConversationLinks().map((link) => link.querySelector('.gbm-checkbox')).filter(Boolean);
    boxes.forEach((box) => {
      const link = box.closest('a');
      const selected = state.selected.has(conversationId(link));
      box.checked = selected;
      link.classList.toggle('gbm-selected', selected);
    });
    const selectAll = toolbar.querySelector('[data-gbm-select-all]');
    const allSelected = state.knownAllIds !== null &&
      [...state.knownAllIds].every((id) => state.selected.has(id));
    selectAll.checked = allSelected;
    selectAll.indeterminate = count > 0 && !allSelected;
  }

  function clearSelection() {
    state.selectController?.abort();
    state.selected.clear();
    state.knownAllIds = null;
    setStatus('');
    refresh();
  }

  function hideConversation(id) {
    state.hiddenIds.add(id);
    state.knownAllIds?.delete(id);
    allConversationLinks().filter((link) => conversationId(link) === id).forEach((link) => {
      conversationRow(link).classList.add('gbm-hidden');
    });
  }

  function selectedItems() {
    return [...state.selected.values()];
  }

  async function selectAllConversations() {
    if (state.busy) return;
    state.busy = true;
    const controller = new AbortController();
    state.selectController = controller;
    const checkbox = ensureToolbar().querySelector('[data-gbm-select-all]');
    checkbox.disabled = true;
    setStatus('正在读取全部未归档对话…');
    try {
      const all = await fetchAllConversations((loaded, total) => {
        setStatus(`正在读取对话：${loaded}${total === null ? '' : `/${total}`}`);
      }, controller.signal);
      if (controller.signal.aborted) return;
      const ids = new Set(all.keys());
      state.knownAllIds = ids;
      state.selected = all;
      setStatus(`已选择全部 ${ids.size} 个未归档对话`);
    } catch (error) {
      if (error.name !== 'AbortError') {
        const message = `全选失败：${error.message}`;
        setStatus(message);
        notify(message);
      }
    } finally {
      state.busy = false;
      state.selectController = null;
      checkbox.disabled = false;
      refresh();
    }
  }

  async function fetchAllConversations(onProgress, signal) {
    const conversations = new Map();
    let offset = 0;
    while (true) {
      const url = new URL(`${ORIGIN}/backend-api/conversations`);
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('limit', String(LIST_PAGE_SIZE));
      url.searchParams.set('order', 'updated');
      url.searchParams.set('is_archived', 'false');
      let token = await getAccessToken();
      if (!token) throw new Error('无法获取 ChatGPT 登录会话');
      let response = await fetch(url, {
        credentials: 'include',
        signal,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
      });
      if (response.status === 401) {
        state.accessToken = null;
        token = await getAccessToken();
        if (!token) throw new Error('登录会话已失效');
        response = await fetch(url, {
          credentials: 'include',
          signal,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
        });
      }
      if (!response.ok) throw new Error(`列表请求 HTTP ${response.status}`);
      const page = await response.json();
      if (!Array.isArray(page.items)) throw new Error('对话列表格式发生变化');
      for (const item of page.items) {
        if (typeof item.id !== 'string' || state.hiddenIds.has(item.id)) continue;
        const link = findConversationLink(item.id);
        conversations.set(item.id, {
          id: item.id,
          title: item.title || (link ? titleOf(link) : 'Untitled conversation'),
          link,
          url: `${ORIGIN}/c/${encodeURIComponent(item.id)}`
        });
      }
      const total = Number.isFinite(page.total) ? page.total : null;
      offset += page.items.length;
      onProgress(conversations.size, total);
      if (page.items.length === 0) {
        if (total !== null && offset < total) throw new Error(`只读取到 ${offset}/${total} 个对话`);
        break;
      }
      if (total !== null ? offset >= total : page.items.length < LIST_PAGE_SIZE) break;
    }
    return conversations;
  }

  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportSelected() {
    const data = selectedItems().map(({ id, title, link }) => ({
      id,
      title,
      url: link?.href || `${ORIGIN}/c/${encodeURIComponent(id)}`,
      exportedAt: new Date().toISOString()
    }));
    download(`gpt-conversations-${dateStamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
    notify(`已导出 ${data.length} 个对话`);
  }

  async function runAction(action) {
    const items = selectedItems();
    if (!items.length || state.busy) return;
    if (action === 'export') return exportSelected();
    if (action === 'move' && items.some((item) => !findConversationLink(item.id))) {
      setStatus('移动目前只支持已显示在侧栏的对话；请缩小选择范围');
      return;
    }
    if (action === 'delete' && !confirm(`确定删除选中的 ${items.length} 个对话吗？删除后可能无法恢复。`)) return;

    state.busy = true;
    let completed = 0;
    let failure = '';
    const toolbar = ensureToolbar();
    toolbar.querySelectorAll('[data-gbm-action]').forEach((button) => { button.disabled = true; });
    toolbar.querySelector('[data-gbm-select-all]').disabled = true;
    toolbar.querySelector('.gbm-close').disabled = true;
    setStatus(`${actionLabel(action)}中：0/${items.length}`);
    try {
      let next = 0;
      let stopped = false;
      const worker = async () => {
        while (next < items.length && !stopped) {
          const item = items[next++];
          const result = action === 'delete'
            ? await deleteConversation(item.id)
            : action === 'archive'
              ? await updateConversation(item.id, { is_archived: true })
              : { ok: await invokeConversationMenu(item, action) };
          if (result.ok) {
            completed += 1;
            state.selected.delete(item.id);
            if (action === 'delete' || action === 'archive') hideConversation(item.id);
          } else {
            failure = result.reason || '无法完成操作';
            if (result.stop) stopped = true;
          }
          setStatus(`${actionLabel(action)}中：${completed}/${items.length}`);
        }
      };
      const concurrency = action === 'move' ? 1 : Math.min(BATCH_CONCURRENCY, items.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      const message = failure
        ? `${actionLabel(action)}成功 ${completed}/${items.length}；失败：${failure}`
        : `${actionLabel(action)}成功 ${completed}/${items.length}`;
      setStatus(message);
      notify(message);
    } finally {
      state.busy = false;
      toolbar.querySelectorAll('[data-gbm-action]').forEach((button) => { button.disabled = false; });
      toolbar.querySelector('[data-gbm-select-all]').disabled = false;
      toolbar.querySelector('.gbm-close').disabled = false;
      refresh();
    }
  }

  async function invokeConversationMenu(item, action) {
    const link = findConversationLink(item.id) || item.link;
    if (!link || !link.isConnected) return false;
    const menuButton = findMenuButton(link);
    if (!menuButton) return false;
    menuButton.click();
    await wait(150);
    const option = findMenuOption(action);
    if (!option) return false;
    option.click();
    await wait(350);
    if (action === 'delete') {
      const confirmButton = await waitForConfirmationButton();
      if (confirmButton) {
        confirmButton.click();
        await wait(600);
        return !findConversationLink(item.id);
      }
    }
    return true;
  }

  async function deleteConversation(id) {
    return sendConversationRequest(`${ORIGIN}/backend-api/conversation/id/${encodeURIComponent(id)}`, 'DELETE');
  }

  async function updateConversation(id, payload) {
    return sendConversationRequest(`${ORIGIN}/backend-api/conversation/${encodeURIComponent(id)}`, 'PATCH', payload);
  }

  async function sendConversationRequest(url, method, payload) {
    try {
      let accessToken = await getAccessToken();
      if (!accessToken) return { ok: false, stop: true, reason: '无法获取 ChatGPT 登录会话，请刷新网页后重试' };
      let response = await send(accessToken);
      if (response.status === 401) {
        state.accessToken = null;
        accessToken = await getAccessToken();
        if (accessToken) response = await send(accessToken);
      }
      if (response.ok) return { ok: true };
      const stop = [401, 403, 404, 429].includes(response.status);
      return { ok: false, stop, reason: `HTTP ${response.status}${response.status === 401 ? '，登录会话无效' : ''}` };
    } catch (error) {
      console.warn('[GPT Batch Manager] request failed', error);
      return { ok: false, stop: true, reason: '网络请求失败，请检查扩展控制台' };
    }

    function send(token) {
      return fetch(url, {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${token}`
        },
        ...(payload ? { body: JSON.stringify(payload) } : {})
      });
    }
  }

  async function getAccessToken() {
    if (state.accessToken) return state.accessToken;
    if (!state.tokenPromise) {
      state.tokenPromise = (async () => {
        const response = await fetch(`${ORIGIN}/api/auth/session`, {
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) return null;
        const session = await response.json();
        state.accessToken = session.accessToken || session.access_token || null;
        return state.accessToken;
      })().finally(() => { state.tokenPromise = null; });
    }
    return state.tokenPromise;
  }

  function findConversationLink(id) {
    return getConversationLinks().find((link) => conversationId(link) === id) || null;
  }

  function findMenuButton(link) {
    let node = link;
    for (let level = 0; node && level < 6; level += 1, node = node.parentElement) {
      const buttons = [...node.querySelectorAll('button')].filter((button) => button.offsetParent !== null);
      const labeled = buttons.find((button) => {
        const label = `${button.getAttribute('aria-label') || ''} ${button.title || ''} ${button.dataset.testid || ''}`.toLowerCase();
        return /more|option|menu|更多|选项|菜单/.test(label);
      });
      if (labeled) return labeled;
      const menuButton = buttons.find((button) => button.getAttribute('aria-haspopup') === 'menu');
      if (menuButton) return menuButton;
    }
    return null;
  }

  function findMenuOption(action) {
    const labels = {
      delete: ['删除', 'delete'],
      archive: ['归档', 'archive'],
      move: ['移动到项目', '移动', 'move to project', 'move']
    }[action] || [];
    const menus = [...document.querySelectorAll('[role="menu"]')]
      .filter((menu) => menu.offsetParent !== null);
    const roots = menus.length ? menus : [document];
    const candidates = roots.flatMap((root) => [
      ...root.querySelectorAll('[role="menuitem"], button')
    ]);
    return candidates.find((node) => {
      if (node.offsetParent === null || state.toolbar?.contains(node)) return false;
      const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return labels.some((label) => text === label || text.startsWith(`${label} `));
    });
  }

  function findConfirmationButton() {
    const dialog = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
      .find((node) => node.offsetParent !== null && /删除|delete/i.test(node.innerText || ''));
    if (!dialog) return null;
    const root = dialog;
    return [...root.querySelectorAll('button')].reverse().find((button) => {
      if (button.offsetParent === null) return false;
      const text = (button.innerText || button.textContent || '').trim().toLowerCase();
      return text === '删除' || text === 'delete' || text.includes('确认删除');
    });
  }

  async function waitForConfirmationButton() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const button = findConfirmationButton();
      if (button) return button;
      await wait(150);
    }
    return null;
  }

  function actionLabel(action) {
    return { archive: '归档', move: '移动', delete: '删除' }[action] || action;
  }

  function notify(message) {
    const toast = document.createElement('div');
    toast.className = 'gbm-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  function setStatus(message) {
    ensureToolbar().querySelector('.gbm-status').textContent = message;
    ensureToolbar().classList.toggle('gbm-toolbar--visible', state.selected.size > 0 || Boolean(message));
  }

  function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function dateStamp() { return new Date().toISOString().slice(0, 10); }

  function findSidebar() {
    const link = document.querySelector(SELECTOR);
    if (!link) return null;
    return link.closest('nav, aside') || link.parentElement?.parentElement || null;
  }

  function scheduleDecorate() {
    if (state.decorateTimer !== null) return;
    state.decorateTimer = requestAnimationFrame(() => {
      state.decorateTimer = null;
      decorate();
    });
  }

  function attachSidebarObserver() {
    const nextSidebar = findSidebar();
    if (!nextSidebar || nextSidebar === state.sidebar) return;
    state.sidebarObserver?.disconnect();
    state.sidebar = nextSidebar;
    state.sidebarObserver = new MutationObserver(scheduleDecorate);
    state.sidebarObserver.observe(state.sidebar, { childList: true, subtree: true });
    scheduleDecorate();
  }

  function scheduleSidebarCheck() {
    if (state.sidebar?.isConnected) return;
    clearTimeout(state.sidebarTimer);
    state.sidebarTimer = setTimeout(attachSidebarObserver, 50);
  }

  function init() {
    ensureToolbar();
    attachSidebarObserver();
    // 只用于发现 ChatGPT 是否重建了左侧栏，不再对每次页面变化执行完整扫描。
    state.bodyObserver = new MutationObserver(scheduleSidebarCheck);
    state.bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  init();
})();
