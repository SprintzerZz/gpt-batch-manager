'use strict';

const styleGroup = document.getElementById('style-group');
const accentGroup = document.getElementById('accent-group');
const languageGroup = document.getElementById('language');
const statusEl = document.getElementById('status');

const RETRO_ACCENTS = ['paper', 'mac', 'amber'];
const MODERN_ACCENTS = ['mono', 'blue', 'indigo'];

let saved = {
  language: 'zh-CN',
  uiStyle: 'retro',
  retroAccent: 'paper',
  modernAccent: 'mono'
};

function activeAccent(settings = saved) {
  return settings.uiStyle === 'modern' ? settings.modernAccent : settings.retroAccent;
}

function normalizeSettings(raw = {}) {
  const uiStyle = raw.uiStyle === 'modern' ? 'modern' : 'retro';
  const retroAccent = RETRO_ACCENTS.includes(raw.retroAccent)
    ? raw.retroAccent
    : (RETRO_ACCENTS.includes(raw.uiAccent) ? raw.uiAccent : 'paper');
  const modernAccent = MODERN_ACCENTS.includes(raw.modernAccent)
    ? raw.modernAccent
    : (MODERN_ACCENTS.includes(raw.uiAccent) ? raw.uiAccent : 'mono');
  return {
    language: raw.language === 'en' ? 'en' : 'zh-CN',
    uiStyle,
    retroAccent,
    modernAccent
  };
}

function setControlsDisabled(disabled) {
  styleGroup.disabled = disabled;
  accentGroup.disabled = disabled;
  languageGroup.disabled = disabled;
}

function render() {
  const en = saved.language === 'en';
  const accent = activeAccent(saved);
  document.documentElement.lang = saved.language;
  document.documentElement.dataset.gbmStyle = saved.uiStyle;
  document.documentElement.dataset.gbmAccent = accent;

  document.getElementById('subtitle').textContent = en
    ? 'Lightweight batch organizer for ChatGPT'
    : 'ChatGPT 轻量批量整理助手';
  document.getElementById('style-title').textContent = en ? 'Interface mode' : '界面模式';
  document.getElementById('style-retro-label').textContent = en ? 'Retro' : '复古模式';
  document.getElementById('style-retro-sub').textContent = en ? 'Vintage' : 'Retro';
  document.getElementById('style-modern-label').textContent = en ? 'Modern' : '现代模式';
  document.getElementById('style-modern-sub').textContent = en ? 'Glass UI' : 'Modern';

  document.getElementById('accent-title').textContent = saved.uiStyle === 'retro'
    ? (en ? 'Retro palette' : '复古配色')
    : (en ? 'Modern palette' : '现代配色');

  document.getElementById('accent-paper-label').textContent = en ? 'Paper' : '纸墨档案';
  document.getElementById('accent-mac-label').textContent = en ? 'Retro Mac' : '经典桌面';
  document.getElementById('accent-amber-label').textContent = en ? 'Amber' : '琥珀仪器';

  document.getElementById('accent-mono-label').textContent = en ? 'Mono' : '极简黑白';
  document.getElementById('accent-blue-label').textContent = en ? 'Tech Blue' : '科技蓝';
  document.getElementById('accent-indigo-label').textContent = en ? 'Indigo' : '静谧紫';

  document.getElementById('language-title').textContent = en ? 'Interface language' : '界面语言';

  styleGroup.querySelector(`input[value="${saved.uiStyle}"]`).checked = true;
  accentGroup.querySelector(`input[name="retroAccent"][value="${saved.retroAccent}"]`).checked = true;
  accentGroup.querySelector(`input[name="modernAccent"][value="${saved.modernAccent}"]`).checked = true;
  languageGroup.querySelector(`input[value="${saved.language}"]`).checked = true;
}

async function applyToCurrentTab(settings) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return false;
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: 'gbm:set-settings',
      language: settings.language,
      uiStyle: settings.uiStyle,
      uiAccent: activeAccent(settings)
    });
    return Boolean(result?.ok || result?.language === settings.language);
  } catch {
    return false;
  }
}

async function handleSettingChange(patch) {
  setControlsDisabled(true);
  statusEl.textContent = '';
  const next = normalizeSettings({ ...saved, ...patch });
  try {
    await chrome.storage.local.set({
      language: next.language,
      uiStyle: next.uiStyle,
      uiAccent: activeAccent(next),
      retroAccent: next.retroAccent,
      modernAccent: next.modernAccent
    });
    saved = next;
    render();
    const applied = await applyToCurrentTab(saved);
    statusEl.textContent = saved.language === 'en'
      ? applied ? 'Applied to this tab.' : 'Saved. Refresh ChatGPT if it is already open.'
      : applied ? '已应用到当前标签页。' : '已保存。如已打开 ChatGPT，请刷新页面。';
  } catch {
    render();
    statusEl.textContent = saved.language === 'en'
      ? 'Could not save. Try again.'
      : '保存失败，请重试。';
  } finally {
    setControlsDisabled(false);
  }
}

styleGroup.addEventListener('change', ({ target }) => {
  if (target.name === 'uiStyle') void handleSettingChange({ uiStyle: target.value });
});

accentGroup.addEventListener('change', ({ target }) => {
  if (target.name === 'retroAccent') void handleSettingChange({ retroAccent: target.value });
  else if (target.name === 'modernAccent') void handleSettingChange({ modernAccent: target.value });
});

languageGroup.addEventListener('change', ({ target }) => {
  if (target.name === 'language') void handleSettingChange({ language: target.value });
});

async function init() {
  try {
    const stored = await chrome.storage.local.get([
      'language', 'uiStyle', 'uiAccent', 'retroAccent', 'modernAccent'
    ]);
    saved = normalizeSettings(stored);
    render();
    if (!await applyToCurrentTab(saved)) {
      statusEl.textContent = saved.language === 'en'
        ? 'Refresh ChatGPT if it is already open.'
        : '如已打开 ChatGPT，请刷新页面。';
    }
    setControlsDisabled(false);
  } catch {
    statusEl.textContent = '无法读取设置 / Could not load settings.';
  }
}

void init();
