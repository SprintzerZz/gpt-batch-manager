(function () {
  'use strict';

  const state = {
    selected: new Map(),
    toolbar: null,
    bodyObserver: null,
    sidebarObserver: null,
    sidebar: null,
    decorateTimer: null,
    tagTimer: null,
    sidebarTimer: null,
    busy: false,
    accessToken: null,
    tokenPromise: null,
    selectController: null,
    knownAllIds: null,
    projectById: new Map(),
    hiddenIds: new Set(),
    hiddenRows: new WeakMap(),
    projectLookupTimer: null,
    projectLookupPromise: null,
    projectLookupAt: 0
  };

  // 同时兼容 /c/id 和 https://chatgpt.com/c/id 两种链接形式。
  const SELECTOR = 'a[href*="/c/"]';
  const ORIGIN = window.location.origin;
  const BATCH_CONCURRENCY = 4;
  const LIST_PAGE_SIZE = 100;

  function conversationId(link) {
    const match = link.pathname.match(/\/c\/([^/]+)/);
    return match ? match[1] : '';
  }

  function titleOf(link) {
    const copy = link.cloneNode(true);
    copy.querySelectorAll('.gbm-project-tag').forEach((tag) => tag.remove());
    return (copy.textContent || '').replace(/\s+/g, ' ').trim() || 'Untitled conversation';
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
    const links = allConversationLinks();
    links.forEach((link) => {
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
    refresh(links);
    scheduleTagRefresh();
  }

  function scheduleTagRefresh() {
    if (state.tagTimer !== null) return;
    state.tagTimer = setTimeout(() => {
      state.tagTimer = null;
      refreshProjectTags();
    }, 150);
  }

  function refreshProjectTags() {
    const projects = sidebarProjects();
    const links = allConversationLinks();
    const { byLink: projectByLink, recentLinks } = projectAssignments(links, projects);
    links.forEach((link) => {
      const id = conversationId(link);
      if (state.hiddenIds.has(id)) return;
      const project = projectForConversation(link, projects, projectByLink);
      if (project) {
        state.projectById.set(id, { name: project.name, key: projectPath(project.link) || project.key });
      }
      updateProjectTag(link, state.projectById.get(id));
    });
    scheduleProjectLookup(recentLinks);
  }

  function projectAssignments(links, projects) {
    const root = state.sidebar || document;
    const events = new Map(projects.filter((project) => root.contains(project.link))
      .map((project) => [project.link, { project }]));
    root.querySelectorAll('span, div, h2, h3, [role="heading"]').forEach((node) => {
      if (node.children.length > 3 || !/^(最近|Recents|Recent|已归档|Archived)$/i.test(node.textContent?.trim() || '')) return;
      if (!node.closest(SELECTOR) && !node.querySelector(SELECTOR)) {
        events.set(node, { section: /^(最近|Recents|Recent)$/i.test(node.textContent.trim()) ? 'recent' : 'other' });
      }
    });
    links.forEach((link) => events.set(link, { link }));
    const assignments = new Map();
    const recentLinks = new Set();
    let active = null;
    let inRecent = false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.currentNode; node; node = walker.nextNode()) {
      const event = events.get(node);
      if (!event) continue;
      if (event.link) {
        assignments.set(event.link, active);
        if (inRecent) recentLinks.add(event.link);
      } else if (event.section) {
        active = null;
        inRecent = event.section === 'recent';
      } else {
        active = event.project;
        inRecent = false;
      }
    }
    return { byLink: assignments, recentLinks };
  }

  function projectForConversation(link, projects, projectByLink) {
    const path = projectPath(link);
    if (path) {
      const project = projects.find((item) => projectPath(item.link) === path);
      if (project) return project;
    }
    return projectByLink.get(link) || null;
  }

  function projectColor(key) {
    let hash = 2166136261;
    for (const character of key) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `hsl(${(hash >>> 0) % 360} 68% 38%)`;
  }

  function updateProjectTag(link, project) {
    let tag = link.querySelector('.gbm-project-tag');
    if (!project) {
      tag?.remove();
      return;
    }
    const key = project.key;
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'gbm-project-tag';
      tag.setAttribute('aria-hidden', 'true');
      const box = link.querySelector('.gbm-checkbox');
      if (box) box.after(tag);
      else link.prepend(tag);
    }
    if (tag.dataset.gbmProject === key && tag.textContent === project.name) return;
    tag.dataset.gbmProject = key;
    tag.textContent = project.name;
    tag.title = `项目：${project.name}`;
    tag.style.backgroundColor = projectColor(key);
  }

  function scheduleProjectLookup(recentLinks) {
    const missing = [...recentLinks].map(conversationId)
      .filter((id) => !state.projectById.has(id) && !state.hiddenIds.has(id));
    if (!missing.length || state.projectLookupTimer || state.projectLookupPromise ||
        Date.now() - state.projectLookupAt < 600000) return;
    state.projectLookupTimer = setTimeout(() => {
      state.projectLookupTimer = null;
      state.projectLookupAt = Date.now();
      state.projectLookupPromise = loadProjectMemberships(new Set(missing))
        .catch((error) => console.warn('[GPT Batch Manager] project labels unavailable', error))
        .finally(() => { state.projectLookupPromise = null; });
    }, 1600);
  }

  async function loadProjectMemberships(missing) {
    if (!await getAccessToken()) return;
    const uiProjects = sidebarProjects();
    const projects = [];
    const cursors = new Set();
    let cursor = null;
    for (let pageNumber = 0; pageNumber < 8; pageNumber += 1) {
      const url = new URL(`${ORIGIN}/backend-api/gizmos/snorlax/sidebar`);
      url.searchParams.set('owned_only', 'false');
      url.searchParams.set('conversations_per_gizmo', '20');
      if (cursor) url.searchParams.set('cursor', cursor);
      const page = await readProjectJson(url);
      if (!Array.isArray(page.items)) return;
      for (const item of page.items) {
        const gizmo = item.gizmo?.gizmo || item.gizmo || item;
        const id = gizmo.id || item.project_id;
        const name = gizmo.display?.name || gizmo.name || item.name;
        if (typeof id !== 'string' || !id.startsWith('g-p-') || typeof name !== 'string') continue;
        const match = uiProjects.find((project) => projectPath(project.link) === `/g/${id}`) ||
          uiProjects.find((project) => project.name === name);
        const descriptor = { name, key: match ? projectPath(match.link) || match.key : `/g/${id}` };
        const conversations = item.gizmo?.conversations || item.conversations;
        projects.push({ id, descriptor, needsFetch: !conversations?.items?.length &&
          gizmo.num_interactions !== 0 });
        addProjectConversations(conversations?.items, descriptor, missing);
      }
      if (!page.cursor || cursors.has(page.cursor)) break;
      cursors.add(page.cursor);
      cursor = page.cursor;
    }

    // 仅在侧栏接口没有嵌入对话时补读，避免为所有项目重复发请求。
    let requests = 0;
    for (const project of projects) {
      if (!missing.size || requests >= 12) break;
      if (!project.needsFetch) continue;
      const url = new URL(`${ORIGIN}/backend-api/gizmos/${encodeURIComponent(project.id)}/conversations`);
      url.searchParams.set('cursor', '0');
      try {
        const page = await readProjectJson(url);
        addProjectConversations(page.items, project.descriptor, missing);
      } catch (error) {
        console.warn('[GPT Batch Manager] project conversation list unavailable', error);
      }
      requests += 1;
    }
    scheduleDecorate();
  }

  function addProjectConversations(items, descriptor, missing) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (typeof item.id !== 'string' || state.hiddenIds.has(item.id)) continue;
      state.projectById.set(item.id, descriptor);
      missing.delete(item.id);
    }
  }

  async function readProjectJson(url) {
    let token = await getAccessToken();
    if (!token) throw new Error('登录会话不可用');
    let response = await request(token);
    if (response.status === 401) {
      state.accessToken = null;
      token = await getAccessToken();
      if (!token) throw new Error('登录会话已失效');
      response = await request(token);
    }
    if (!response.ok) throw new Error(`项目列表 HTTP ${response.status}`);
    return response.json();

    function request(accessToken) {
      return fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
      });
    }
  }

  function refresh(links = getConversationLinks()) {
    const count = state.selected.size;
    const toolbar = ensureToolbar();
    toolbar.classList.toggle('gbm-toolbar--visible', count > 0 || Boolean(toolbar.querySelector('.gbm-status').textContent));
    toolbar.querySelector('.gbm-count').textContent = `已选择 ${count} 项`;
    const boxes = links.filter((link) => !state.hiddenIds.has(conversationId(link)))
      .map((link) => link.querySelector('.gbm-checkbox')).filter(Boolean);
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
    state.projectById.delete(id);
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
    const failures = [];
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
      let submitted = 0;
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
            if (result.submitted) submitted += 1;
            clearItemSelection(item.id);
            if (action === 'delete' || action === 'archive') hideConversation(item.id);
            if (action === 'move' && !result.submitted) {
              state.projectById.set(item.id, { name: project.name, key: projectPath(project.link) || project.key });
            }
          } else {
            failures.push({ id: item.id, reason: result.reason || '无法完成操作' });
            if (result.stop) stopped = true;
          }
          setStatus(`${actionLabel(action)}中：${completed}/${items.length}`);
        }
      };
      const concurrency = action === 'move' ? 1 : Math.min(BATCH_CONCURRENCY, items.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      const failure = failures.at(-1)?.reason || '';
      const message = failure
        ? `${actionLabel(action)}成功 ${completed}/${items.length}；失败：${failure}`
        : submitted ? `移动已提交 ${completed}/${items.length}；${submitted} 项未收到页面确认，请到目标项目核对`
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
    const row = conversationRow(link);
    const snapshot = { id: item.id, row, parent: row.parentElement, href: link.href,
      projectPath: projectPath(project.link) };
    const menuButton = findMenuButton(link);
    if (menuButton) {
      const menusBefore = new Set([...document.querySelectorAll('[role="menu"]')].filter(isVisibleElement));
      const bodyChildrenBefore = new Set(document.body.children);
      menuButton.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true
      }));
      let option = await waitForMenuOption('move', 3,
        menuButton.getAttribute('aria-expanded') === 'true' ? null : menusBefore);
      const openedByPointer = [...document.querySelectorAll('[role="menu"]')]
        .some((menu) => isVisibleElement(menu) && !menusBefore.has(menu)) ||
        [...document.body.children].some((child) => !bodyChildrenBefore.has(child) && isVisibleElement(child));
      if (!option && menuButton.getAttribute('aria-expanded') !== 'true' && !openedByPointer) {
        menuButton.click();
        option = await waitForMenuOption('move', 12, menusBefore);
      }
      if (!option) {
        if (await waitForMove(snapshot, 8)) return { ok: true };
        return { ok: false, reason: `“${item.title}”的菜单中没有“移至项目”；此对话可能不支持移动` };
      }
      option.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, isPrimary: true
      }));
      let matches = await waitForProjectChoices(project.name, 3);
      if (!matches.length) {
        option.click();
        matches = await waitForProjectChoices(project.name);
      }
      if (matches.length !== 1) {
        if (await waitForMove(snapshot, 8)) return { ok: true };
        return { ok: false, reason: matches.length
          ? `找到多个同名项目“${project.name}”，无法安全选择`
          : `移动菜单中未找到项目“${project.name}”` };
      }
      matches[0].click();
      if (await waitForMove(snapshot, 10)) return { ok: true };
      // ChatGPT 有时只更新服务端状态，侧栏当前行不变；已点击目标项时不误报失败。
      return { ok: true, submitted: true };
    }
    const source = link.closest('[draggable="true"]');
    const target = sidebarProjects().find((item) => item.key === project.key)?.link ||
      (project.link.isConnected ? project.link : null);
    if (!source || !target) return { ok: false, reason: '未找到对话的更多菜单或可拖放的项目行' };
    try {
      dragToProject(source, target);
      if (await waitForMove(snapshot)) return { ok: true };
    } catch (error) {
      console.warn('[GPT Batch Manager] drag failed', error);
    }
    return { ok: false, reason: '未找到对话的更多菜单，拖放也未生效' };
  }

  function sidebarProjects() {
    const root = state.sidebar || document;
    const folderRows = [...root.querySelectorAll('[data-marquee-content="true"]')]
      .flatMap((title, index) => {
        if (title.closest(SELECTOR)) return [];
        let row = title.closest('[class~="group/folder-row"]');
        // 新版侧栏可能只在操作菜单上保留 folder-row 类名。
        for (let node = title.parentElement, depth = 0; !row && node && depth < 7; node = node.parentElement, depth += 1) {
          if (node.querySelector('[class*="group-hover/folder-row"]') &&
              node.querySelectorAll('[data-marquee-content="true"]').length === 1) row = node;
        }
        const name = title.textContent?.replace(/\s+/g, ' ').trim();
        if (!row && name && !/^(项目|Projects|最近|Recents|Recent)$/i.test(name)) {
          for (let node = title.parentElement, depth = 0; node && depth < 9 && !node.matches('nav, aside');
            node = node.parentElement, depth += 1) {
            if (node.querySelectorAll('[data-marquee-content="true"]').length !== 1 || node.querySelector(SELECTOR)) break;
            if (node.querySelector('svg') && !node.closest('.gbm-toolbar, .gbm-project-picker')) row = node;
          }
        }
        return row && name && !row.closest('.gbm-project-picker')
          ? [{ name, link: row, key: `folder:${index}:${name}` }]
          : [];
      });
    const seen = new Set();
    const linked = [...root.querySelectorAll('a[href]')].flatMap((link) => {
      const url = new URL(link.href);
      if (url.origin !== ORIGIN || !/\/(?:g\/g-p-|project\/)/.test(url.pathname) || url.pathname.includes('/c/')) return [];
      const name = (link.innerText || link.getAttribute('aria-label') || link.title || '').replace(/\s+/g, ' ').trim();
      if (!name || seen.has(url.pathname) || folderRows.some((item) => item.link.contains(link))) return [];
      seen.add(url.pathname);
      return [{ name, link, key: url.pathname }];
    });
    if (folderRows.length || linked.length) return [...folderRows, ...linked];

    // ChatGPT 有时用按钮而不是项目链接；从侧栏“项目”标题附近寻找文件夹行。
    const heading = [...root.querySelectorAll('span, div, h2, h3')]
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

  function projectPath(node) {
    const anchor = node?.matches?.('a[href]') ? node : node?.querySelector?.('a[href*="/g/g-p-"]');
    const match = anchor?.href && new URL(anchor.href).pathname.match(/^\/g\/g-p-[^/]+/);
    return match?.[0] || null;
  }

  function hasMoved(snapshot) {
    if (!snapshot.row.isConnected || snapshot.row.parentElement !== snapshot.parent) return true;
    const links = [...document.querySelectorAll(SELECTOR)].filter((link) => conversationId(link) === snapshot.id);
    return links.some((link) => {
      if (link.href === snapshot.href) return false;
      const path = projectPath(link);
      return Boolean(path && (!snapshot.projectPath || path === snapshot.projectPath));
    });
  }

  async function waitForMove(snapshot, attempts = 20) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (hasMoved(snapshot)) return true;
      await wait(300);
    }
    return hasMoved(snapshot);
  }

  function clearItemSelection(id) {
    state.selected.delete(id);
    state.knownAllIds?.delete(id);
    document.querySelectorAll(SELECTOR).forEach((link) => {
      if (conversationId(link) !== id) return;
      const box = link.querySelector('.gbm-checkbox');
      if (box) box.checked = false;
      link.classList.remove('gbm-selected');
    });
    refresh();
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
    for (let level = 0; node && level < 8; level += 1, node = node.parentElement) {
      if (node.matches('nav, aside')) break;
      if (node.querySelectorAll(SELECTOR).length > 1) break;
      const buttons = [...node.querySelectorAll('button')]
        .filter((button) => isVisibleElement(button) && !link.contains(button) && !state.toolbar?.contains(button));
      const labeled = buttons.find((button) => {
        const label = `${button.getAttribute('aria-label') || ''} ${button.title || ''} ${button.dataset.testid || ''}`.toLowerCase();
        return /more|option|menu|更多|选项|菜单/.test(label);
      });
      if (labeled) return labeled;
      const menuButton = buttons.find((button) => button.getAttribute('aria-haspopup') === 'menu');
      if (menuButton) return menuButton;
      if (buttons.length === 1 && node.querySelectorAll(SELECTOR).length === 1) return buttons[0];
    }
    return null;
  }

  function isVisibleElement(node) {
    if (!node.isConnected || !node.getClientRects().length) return false;
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function findMenuOption(action, excludeMenus = null) {
    const labels = {
      delete: ['删除', 'delete'],
      archive: ['归档', 'archive'],
      move: ['移至项目', '移动到项目', '移动', 'move to project', 'move']
    }[action] || [];
    const allMenus = [...document.querySelectorAll('[role="menu"]')].filter(isVisibleElement);
    const menus = allMenus.filter((menu) => !excludeMenus?.has(menu));
    const roots = menus.length ? menus : allMenus.length ? [] : [document];
    const candidates = roots.flatMap((root) => [
      ...root.querySelectorAll('[role="menuitem"], button, span, div')
    ]).sort((a, b) => a.contains(b) ? 1 : b.contains(a) ? -1 : 0);
    return candidates.find((node) => {
      if (!isVisibleElement(node) || state.toolbar?.contains(node)) return false;
      const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return labels.some((label) => text === label || text.startsWith(label));
    });
  }

  async function waitForMenuOption(action, attempts = 12, excludeMenus = null) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const option = findMenuOption(action, excludeMenus);
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
      .filter((root) => isVisibleElement(root) && !state.toolbar?.contains(root));
    // ChatGPT 的项目弹窗也可能是挂在 body 下、没有 ARIA role 的 portal。
    if (state.sidebar) roots.push(...[...document.body.children].filter((root) =>
      root !== state.sidebar && !root.contains(state.sidebar) &&
      !root.matches('.gbm-toolbar, .gbm-project-picker, .gbm-toast') && isVisibleElement(root)));
    return [...new Set(roots.flatMap((root) => [...root.querySelectorAll('[role="menuitem"], [role="option"], [cmdk-item], button, span, div')]))]
      .filter((node) => isVisibleElement(node) && projectChoiceName(node));
  }

  async function waitForProjectChoices(name, attempts = 20) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const matches = projectChoices().filter((choice) => projectChoiceName(choice) === name);
      if (matches.length) {
        return matches.filter((choice) => !matches.some((other) => other !== choice && choice.contains(other)));
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
    state.decorateTimer = setTimeout(() => {
      state.decorateTimer = null;
      decorate();
    }, 32);
  }

  function isOwnMutation(record) {
    if (record.type !== 'childList') return false;
    const nodes = [...record.addedNodes, ...record.removedNodes];
    return nodes.length > 0 && nodes.every((node) => node.nodeType === Node.ELEMENT_NODE &&
      (node.matches('.gbm-checkbox, .gbm-project-tag') || node.closest?.('.gbm-toolbar, .gbm-toast')));
  }

  function attachSidebarObserver() {
    const nextSidebar = findSidebar();
    if (!nextSidebar || nextSidebar === state.sidebar) return;
    state.sidebarObserver?.disconnect();
    state.sidebar = nextSidebar;
    state.sidebarObserver = new MutationObserver((records) => {
      if (records.some((record) => !isOwnMutation(record))) scheduleDecorate();
    });
    state.sidebarObserver.observe(state.sidebar, { childList: true, subtree: true,
      attributes: true, attributeFilter: ['href'] });
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
