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
    try {
      const choice = action === 'move' ? await chooseProject() : null;
      if (action === 'move' && !choice.project) {
        setStatus(choice.reason);
        return;
      }
      const project = choice?.project;
      setStatus(`${actionLabel(action)}中：0/${items.length}`);
      let next = 0;
      let stopped = false;
      const worker = async () => {
        while (next < items.length && !stopped) {
          const item = items[next++];
          const result = action === 'delete'
            ? await deleteConversation(item.id)
            : action === 'archive'
              ? await updateConversation(item.id, { is_archived: true })
              : await moveConversation(item, project);
          if (result.ok) {
            completed += 1;
            state.selected.delete(item.id);
            if (action === 'delete' || action === 'archive') hideConversation(item.id);
          } else {
            failure = result.reason || '无法完成操作';
            if (result.stop || action === 'move') stopped = true;
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

  async function moveConversation(item, project) {
    const link = findConversationLink(item.id) || item.link;
    if (!link || !link.isConnected) return { ok: false, reason: '对话未显示在侧栏' };
    const source = link.closest('[draggable="true"]');
    const target = sidebarProjects().find((item) => item.key === project.key)?.link ||
      (project.link.isConnected ? project.link : null);
    if (source && target) {
      const row = conversationRow(link);
      const parent = row.parentElement;
      try {
        dragToProject(source, target);
        if (await waitForMovedRow(row, parent)) return { ok: true };
      } catch (error) {
        console.warn('[GPT Batch Manager] drag failed', error);
      }
    }
    const currentLink = findConversationLink(item.id);
    if (!currentLink) return { ok: false, reason: '对话已从侧栏消失；请检查目标项目' };
    const menuButton = findMenuButton(currentLink);
    if (menuButton) {
      menuButton.click();
      const option = await waitForMenuOption('move');
      if (option) {
        option.click();
        const matches = await waitForProjectChoices(project.name);
        if (matches.length === 1) {
          const row = conversationRow(currentLink);
          const parent = row.parentElement;
          matches[0].click();
          if (await waitForMovedRow(row, parent)) return { ok: true };
        }
      }
    }
    return { ok: false, reason: `未能确认已移动到“${project.name}”；请检查项目后重试` };
  }

  function sidebarProjects() {
    const folderRows = [...document.querySelectorAll('[class~="group/folder-row"]')]
      .flatMap((row, index) => {
        const title = row.querySelector('[data-marquee-content="true"]');
        const name = title?.textContent?.replace(/\s+/g, ' ').trim();
        return name ? [{ name, link: row, key: `folder:${index}:${name}` }] : [];
      });
    if (folderRows.length) return folderRows;

    const seen = new Set();
    const linked = [...document.querySelectorAll('a[href]')].flatMap((link) => {
      const url = new URL(link.href);
      if (url.origin !== ORIGIN || !/\/(?:g\/g-p-|project\/)/.test(url.pathname) || url.pathname.includes('/c/')) return [];
      const name = (link.innerText || link.getAttribute('aria-label') || link.title || '').replace(/\s+/g, ' ').trim();
      if (!name || seen.has(url.pathname)) return [];
      seen.add(url.pathname);
      return [{ name, link, key: url.pathname }];
    });
    if (linked.length) return linked;

    // ChatGPT 有时用按钮而不是项目链接；从侧栏“项目”标题附近寻找文件夹行。
    const heading = [...document.querySelectorAll('span, div, h2, h3')]
      .filter((node) => /^(项目|Projects)$/i.test(node.textContent?.trim() || '') && node.offsetParent !== null)
      .sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)
      .find((node) => node.getBoundingClientRect().left < 420);
    if (!heading) return [];
    const selector = 'a, button, [role="link"], [role="button"], [data-sidebar-item="true"]';
    for (let section = heading.parentElement, depth = 0; section && depth < 5; section = section.parentElement, depth += 1) {
      const nodes = [...section.querySelectorAll(selector)].filter((node) => {
        if (node === heading || node.contains(heading) || !(heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
        if (node.closest('.gbm-toolbar, .gbm-project-picker') || node.querySelector('a[href*="/c/"], .gbm-checkbox')) return false;
        const name = (node.innerText || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        if (!name || /^(项目|Projects|新建项目|New project|查看更多|Show more)$/i.test(name)) return false;
        return Boolean(node.querySelector('svg') || /project|gizmo/i.test(node.getAttribute('data-testid') || ''));
      });
      const leafNodes = nodes.filter((node) => !nodes.some((other) => other !== node && node.contains(other)));
      if (leafNodes.length) return leafNodes.map((link, index) => ({
        name: (link.innerText || link.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
        link,
        key: `row:${index}`
      }));
    }
    return [];
  }

  function chooseProject() {
    const projects = sidebarProjects();
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'gbm-project-picker';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', '选择目标项目');
      overlay.setAttribute('aria-modal', 'true');
      const panel = document.createElement('div');
      panel.className = 'gbm-project-picker__panel';
      const title = document.createElement('div');
      title.className = 'gbm-project-picker__title';
      title.textContent = '移动到项目';
      const search = document.createElement('input');
      search.type = 'search';
      search.placeholder = '搜索左侧项目';
      search.setAttribute('aria-label', '搜索项目');
      const list = document.createElement('div');
      list.className = 'gbm-project-picker__list';
      if (!projects.length) {
        const empty = document.createElement('p');
        empty.textContent = '未识别到左侧项目。请展开“项目”列表并刷新 ChatGPT 页面后重试。';
        list.appendChild(empty);
        search.disabled = true;
      }
      const buttons = projects.map((project) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = project.name;
        button.addEventListener('click', () => finish(project));
        list.appendChild(button);
        return { button, project };
      });
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'gbm-project-picker__cancel';
      cancel.textContent = projects.length ? '取消' : '关闭';
      cancel.addEventListener('click', () => finish(null));
      search.addEventListener('input', () => {
        const query = search.value.trim().toLocaleLowerCase();
        buttons.forEach(({ button, project }) => {
          button.hidden = !project.name.toLocaleLowerCase().includes(query);
        });
      });
      overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(null); });
      const onKeydown = (event) => { if (event.key === 'Escape') finish(null); };
      function finish(project) {
        document.removeEventListener('keydown', onKeydown, true);
        overlay.remove();
        resolve({ project, reason: projects.length
          ? '已取消移动，所选对话保持不变'
          : '未识别到左侧项目；请展开“项目”列表并刷新页面' });
      }
      document.addEventListener('keydown', onKeydown, true);
      panel.append(title, search, list, cancel);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      if (projects.length) search.focus();
      else cancel.focus();
    });
  }

  async function waitForMovedRow(row, parent) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(300);
      if (!row.isConnected || row.parentElement !== parent) return true;
    }
    return false;
  }

  function dragToProject(source, link) {
    const target = link.closest('[data-sidebar-item="true"]') || link;
    const transfer = new DataTransfer();
    transfer.effectAllowed = 'move';
    for (const [node, type] of [
      [source, 'dragstart'], [target, 'dragenter'], [target, 'dragover'],
      [target, 'drop'], [source, 'dragend']
    ]) {
      node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }
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

  async function waitForMenuOption(action) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const option = findMenuOption(action);
      if (option) return option;
      await wait(150);
    }
    return null;
  }

  function projectChoiceName(node) {
    const name = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!name || /^(移动到项目|move to project|新建项目|create project|new project|取消|cancel|搜索|search)$/i.test(name)) return null;
    return name;
  }

  function projectChoices() {
    const roots = [...document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"]')]
      .filter((root) => root.offsetParent !== null && !state.toolbar?.contains(root));
    return roots.flatMap((root) => [...root.querySelectorAll('[role="menuitem"], [role="option"], [cmdk-item], button')])
      .filter((node) => node.offsetParent !== null && projectChoiceName(node));
  }

  async function waitForProjectChoices(name) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const matches = projectChoices().filter((choice) => projectChoiceName(choice) === name);
      if (matches.length) {
        return matches.filter((choice) => !matches.some((other) => other !== choice && other.contains(choice)));
      }
      await wait(150);
    }
    return [];
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
