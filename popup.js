'use strict';

const choices = document.getElementById('language');
const status = document.getElementById('status');
let saved = 'zh-CN';

function renderLanguage() {
  document.documentElement.lang = saved;
  document.getElementById('language-title').textContent = saved === 'en' ? 'Interface language' : '界面语言';
  choices.querySelector(`input[value="${saved}"]`).checked = true;
}

async function applyToCurrentTab(language) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return false;
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'gbm:set-language', language });
    return result?.language === language;
  } catch {
    return false;
  }
}

choices.addEventListener('change', async ({ target }) => {
  choices.disabled = true;
  status.textContent = '';
  try {
    await chrome.storage.local.set({ language: target.value });
    saved = target.value;
    renderLanguage();
    const applied = await applyToCurrentTab(saved);
    status.textContent = saved === 'en'
      ? applied ? 'Applied to this tab.' : 'Saved. Refresh ChatGPT if it is already open.'
      : applied ? '已应用到当前标签页。' : '已保存。如已打开 ChatGPT，请刷新页面。';
  } catch {
    renderLanguage();
    status.textContent = saved === 'en' ? 'Could not save. Try again.' : '保存失败，请重试。';
  } finally {
    choices.disabled = false;
  }
});

async function init() {
  try {
    const { language } = await chrome.storage.local.get('language');
    saved = language === 'en' ? 'en' : 'zh-CN';
    renderLanguage();
    if (!await applyToCurrentTab(saved)) {
      status.textContent = saved === 'en' ? 'Refresh ChatGPT if it is already open.' : '如已打开 ChatGPT，请刷新页面。';
    }
    choices.disabled = false;
  } catch {
    status.textContent = '无法读取设置 / Could not load settings.';
  }
}

void init();
