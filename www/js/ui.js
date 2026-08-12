/**
 * ui.js — منطق الواجهة الرئيسي: التنقل، الحالة العامة، وربط كل الصفحات بقاعدة البيانات
 */

const App = {
  currentPage: 'settings',
  settings: null,
  liveSession: null,
  voiceOrb: null,
  activeScenario: null,
  activeSessionId: null,
  sessionStartTime: null,
  wordFilter: 'all',
  navHistory: [],
};

/* ===================== أدوات عامة ===================== */

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

function showToast(message, duration = 2600) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), duration);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ===================== التنقل بين الصفحات ===================== */

function navigateTo(pageId) {
  $all('.page').forEach((p) => { p.hidden = p.dataset.page !== pageId; });
  $all('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === pageId));
  App.currentPage = pageId;

  const isMainTab = ['settings', 'words', 'dialogues', 'progress'].includes(pageId);
  $('#bottom-nav').style.display = isMainTab ? 'flex' : 'none';

  if (pageId === 'words') renderWordsPage();
  if (pageId === 'dialogues') renderDialoguesPage();
  if (pageId === 'progress') renderProgressPage();
  if (pageId === 'settings') renderSettingsPage();
}

$all('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.nav));
});

/* ===================== المظهر (داكن/فاتح/تلقائي) ===================== */

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', mode);
  }
  $all('.theme-opt').forEach((b) => b.classList.toggle('active', b.dataset.themeVal === mode));
}

$('#theme-toggle').addEventListener('click', async (e) => {
  const btn = e.target.closest('.theme-opt');
  if (!btn) return;
  const mode = btn.dataset.themeVal;
  await window.DB.Settings.set('theme', mode);
  App.settings.theme = mode;
  applyTheme(mode);
});

/* ===================== التهيئة العامة ===================== */

async function initApp() {
  App.settings = await window.DB.Settings.getAll();
  applyTheme(App.settings.theme || 'auto');

  await seedWordListsIfNeeded();

  navigateTo('settings');
  bindGlobalEvents();
}

async function seedWordListsIfNeeded() {
  const existing = await window.DB.WordLists.getAll();
  if (existing.length === 0) {
    await window.DB.WordLists.seed(window.BUILTIN_WORD_LISTS);
  }
}

document.addEventListener('DOMContentLoaded', initApp);

/* ===================== صفحة الإعدادات ===================== */

async function renderSettingsPage() {
  const apiKeyInput = $('#input-api-key');
  apiKeyInput.value = App.settings.apiKey || '';
  updateApiKeyStatus();

  $('#select-voice-style').value = App.settings.voiceStyle || 'Zephyr';
}

function updateApiKeyStatus() {
  const status = $('#api-key-status');
  status.textContent = App.settings.apiKey
    ? 'تم حفظ المفتاح ✓'
    : 'لم يتم إدخال مفتاح API بعد — مطلوب لتوليد الحوارات وبدء المحادثات الصوتية.';
}

$('#btn-save-api-key').addEventListener('click', async () => {
  const value = $('#input-api-key').value.trim();
  if (!value) {
    showToast('من فضلك أدخل مفتاحًا صالحًا');
    return;
  }
  await window.DB.Settings.set('apiKey', value);
  App.settings.apiKey = value;
  updateApiKeyStatus();
  showToast('تم حفظ المفتاح');
});

$('#btn-toggle-api-key').addEventListener('click', (e) => {
  const input = $('#input-api-key');
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  e.target.textContent = isHidden ? 'إخفاء' : 'إظهار';
});

$('#select-voice-style').addEventListener('change', async (e) => {
  await window.DB.Settings.set('voiceStyle', e.target.value);
  App.settings.voiceStyle = e.target.value;
  showToast('تم تحديث نمط الصوت');
});

$('#btn-export-backup').addEventListener('click', async () => {
  try {
    const data = await window.DB.Backup.exportAll();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `english-live-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('تم تصدير النسخة الاحتياطية');
  } catch (err) {
    showToast('حدث خطأ أثناء التصدير');
    console.error(err);
  }
});

$('#input-import-backup').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await window.DB.Backup.importAll(data);
    showToast('تم استيراد النسخة الاحتياطية بنجاح');
    App.settings = await window.DB.Settings.getAll();
  } catch (err) {
    showToast('ملف النسخة الاحتياطية غير صالح');
    console.error(err);
  } finally {
    e.target.value = '';
  }
});

/* ===================== صفحة الكلمات ===================== */

const STATUS_LABELS = { new: 'جديدة', saving: 'قيد الحفظ', learned: 'متعلَّمة', mastered: 'متقنة' };
const STATUS_PILL_CLASS = { new: 'pill-neutral', saving: 'pill-warning', learned: 'pill-accent', mastered: 'pill-success' };

async function renderWordsPage() {
  $('#input-daily-goal').value = App.settings.dailyWordGoal || 5;
  $('#daily-goal-summary').textContent = `${App.settings.dailyWordGoal || 5} كلمات جديدة يوميًا`;

  await renderWordLists();
  await renderWordsList();
}

$('#input-daily-goal').addEventListener('change', async (e) => {
  const value = Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 5));
  e.target.value = value;
  await window.DB.Settings.set('dailyWordGoal', value);
  App.settings.dailyWordGoal = value;
  $('#daily-goal-summary').textContent = `${value} كلمات جديدة يوميًا`;
});

async function renderWordLists() {
  const lists = await window.DB.WordLists.getAll();
  const allWords = await window.DB.Words.getAll();
  const existingTexts = new Set(allWords.map((w) => w.text.toLowerCase()));

  const container = $('#word-lists-container');
  container.innerHTML = '';

  for (const list of lists) {
    const addedCount = list.words.filter((w) => existingTexts.has(w.text.toLowerCase())).length;
    const card = el('div', { class: 'wordlist-card' }, [
      el('div', { class: 'wl-meta' }, [
        el('h3', {}, `${list.name}`),
        el('p', { class: 'text-sm' }, `${list.level} · ${list.words.length} كلمة${addedCount ? ` · ${addedCount} مُضافة` : ''}`),
      ]),
      el('button', {
        class: 'btn btn-secondary btn-sm',
        onclick: () => addWordListToVocabulary(list),
      }, addedCount === list.words.length ? 'مُضافة ✓' : 'إضافة الكل'),
    ]);
    container.appendChild(card);
  }
}

async function addWordListToVocabulary(list) {
  const allWords = await window.DB.Words.getAll();
  const existingTexts = new Set(allWords.map((w) => w.text.toLowerCase()));
  const toAdd = list.words.filter((w) => !existingTexts.has(w.text.toLowerCase()));

  if (toAdd.length === 0) {
    showToast('كل كلمات هذه القائمة مُضافة بالفعل');
    return;
  }

  await window.DB.Words.bulkAdd(toAdd);
  showToast(`تمت إضافة ${toAdd.length} كلمة`);
  await renderWordLists();
  await renderWordsList();
}

$('#btn-add-word').addEventListener('click', async () => {
  const text = $('#input-word-text').value.trim();
  const translation = $('#input-word-translation').value.trim();
  const example = $('#input-word-example').value.trim();

  if (!text || !translation) {
    showToast('أدخل الكلمة والترجمة على الأقل');
    return;
  }

  await window.DB.Words.add({ text, translation, example });
  $('#input-word-text').value = '';
  $('#input-word-translation').value = '';
  $('#input-word-example').value = '';
  showToast('تمت إضافة الكلمة');
  await renderWordsList();
});

$('#word-filter-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-tab');
  if (!btn) return;
  App.wordFilter = btn.dataset.filter;
  $all('.filter-tab').forEach((t) => t.classList.toggle('active', t === btn));
  renderWordsList();
});

async function renderWordsList() {
  const allWords = await window.DB.Words.getAll();
  const filtered = App.wordFilter === 'all' ? allWords : allWords.filter((w) => w.status === App.wordFilter);
  const container = $('#words-list-container');
  container.innerHTML = '';

  if (filtered.length === 0) {
    container.appendChild(
      el('div', { class: 'empty-state' }, [
        el('div', { class: 'icon' }, '📝'),
        el('p', {}, 'لا توجد كلمات في هذا التصنيف بعد'),
      ])
    );
    return;
  }

  filtered
    .sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded))
    .forEach((word) => {
      const card = el('div', { class: 'word-card' }, [
        el('div', { class: 'word-main' }, [
          el('div', { class: 'en' }, word.text),
          el('div', { class: 'word-translation' }, word.translation),
          word.example ? el('div', { class: 'word-example en' }, word.example) : null,
        ]),
        el('div', { class: 'stack', style: 'align-items:flex-end; gap:6px;' }, [
          el('span', { class: `pill ${STATUS_PILL_CLASS[word.status]}` }, STATUS_LABELS[word.status]),
          el('button', {
            class: 'btn btn-ghost btn-sm',
            style: 'padding:2px 6px; color: var(--danger);',
            onclick: () => deleteWord(word.id),
          }, 'حذف'),
        ]),
      ]);
      container.appendChild(card);
    });
}

async function deleteWord(id) {
  await window.DB.Words.delete(id);
  showToast('تم حذف الكلمة');
  await renderWordsList();
  await renderWordLists();
}

/* ===================== صفحة الحوارات ===================== */

async function renderDialoguesPage() {
  $('#input-sentences-count').value = App.settings.sentencesPerDialogueDefault || 10;

  const allWords = await window.DB.Words.getAll();
  const newWords = allWords.filter((w) => w.status === 'new').slice(0, App.settings.dailyWordGoal || 5);

  const preview = $('#today-words-preview');
  if (newWords.length === 0) {
    preview.textContent = 'لا توجد كلمات جديدة اليوم — أضف كلمات من صفحة الكلمات أولًا.';
  } else {
    preview.innerHTML = 'كلمات اليوم: ' + newWords.map((w) => `<span class="en" style="font-weight:600;">${escapeHtml(w.text)}</span>`).join('، ');
  }

  renderFixedTopicsGrid();
  await renderPastSessions();
}

$('#input-sentences-count').addEventListener('change', async (e) => {
  const value = Math.max(4, Math.min(30, parseInt(e.target.value, 10) || 10));
  e.target.value = value;
  await window.DB.Settings.set('sentencesPerDialogueDefault', value);
  App.settings.sentencesPerDialogueDefault = value;
});

function renderFixedTopicsGrid() {
  const grid = $('#fixed-topics-grid');
  grid.innerHTML = '';
  window.FIXED_SCENARIO_TOPICS.forEach((topic) => {
    const btn = el('button', { class: 'topic-btn', onclick: () => generateFixedScenario(topic.id) }, [
      el('span', { class: 'topic-icon' }, topic.icon),
      el('span', { class: 'topic-label' }, topic.label),
    ]);
    grid.appendChild(btn);
  });
}

function requireApiKey() {
  if (!App.settings.apiKey) {
    showToast('أضف مفتاح Gemini API من صفحة الإعدادات أولًا');
    navigateTo('settings');
    return false;
  }
  return true;
}

$('#btn-generate-words-scenario').addEventListener('click', async () => {
  if (!requireApiKey()) return;
  const btn = $('#btn-generate-words-scenario');
  btn.disabled = true;
  btn.textContent = 'جاري التوليد...';
  try {
    const scenario = await window.ScenarioGenerator.generateWordsScenario({
      apiKey: App.settings.apiKey,
      totalSentences: App.settings.sentencesPerDialogueDefault || 10,
      dailyWordGoal: App.settings.dailyWordGoal || 5,
    });
    openScenarioPreview(scenario);
  } catch (err) {
    showToast(err.message || 'تعذّر توليد الحوار');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'توليد حوار من كلمات اليوم';
  }
});

async function generateFixedScenario(topicId) {
  if (!requireApiKey()) return;
  showToast('جاري توليد الحوار...');
  try {
    const scenario = await window.ScenarioGenerator.generateFixedScenario({
      apiKey: App.settings.apiKey,
      totalSentences: App.settings.sentencesPerDialogueDefault || 10,
      topicId,
    });
    openScenarioPreview(scenario);
  } catch (err) {
    showToast(err.message || 'تعذّر توليد الحوار');
    console.error(err);
  }
}

async function renderPastSessions() {
  const sessions = (await window.DB.Sessions.getAll()).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, 15);
  const container = $('#past-sessions-container');
  container.innerHTML = '';

  if (sessions.length === 0) {
    container.appendChild(
      el('div', { class: 'empty-state' }, [
        el('div', { class: 'icon' }, '💬'),
        el('p', {}, 'لم تبدأ أي محادثة بعد'),
      ])
    );
    return;
  }

  for (const session of sessions) {
    const scenario = await window.DB.Scenarios.getById(session.scenarioId);
    const label = scenario ? scenario.contextLabel : 'حوار محذوف';
    const dateStr = new Date(session.startedAt).toLocaleDateString('ar', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const card = el('div', { class: 'session-card', onclick: () => openSessionDetail(session.id) }, [
      el('div', {}, [
        el('h3', {}, label),
        el('p', { class: 'text-sm' }, dateStr),
      ]),
      el('span', { class: `pill ${session.completed ? 'pill-success' : 'pill-neutral'}` }, session.completed ? 'مكتملة' : 'غير مكتملة'),
    ]);
    container.appendChild(card);
  }
}

/* ===================== معاينة السيناريو ===================== */

function openScenarioPreview(scenario) {
  App.activeScenario = scenario;
  const list = $('#scenario-preview-list');
  list.innerHTML = '';
  list.appendChild(el('h3', {}, scenario.contextLabel));

  scenario.scriptLines.forEach((line) => {
    const isUser = line.speaker === 'user';
    list.appendChild(
      el('div', { class: 'row', style: `justify-content:${isUser ? 'flex-end' : 'flex-start'};` }, [
        el('div', {
          class: 'card',
          style: `max-width:80%; background:${isUser ? 'var(--accent-soft)' : 'var(--bg-sunken)'}; border:none; padding:10px 14px;`,
        }, [
          el('div', { class: 'text-tertiary', style: 'margin-bottom:2px;' }, isUser ? 'أنت' : 'الذكاء الاصطناعي'),
          el('div', { class: 'en' }, line.text),
        ]),
      ])
    );
  });

  navigateTo('scenario-preview');
}

$('#btn-back-from-preview').addEventListener('click', () => navigateTo('dialogues'));

$('#btn-start-live-from-preview').addEventListener('click', () => {
  startLiveSession(App.activeScenario);
});

/* ===================== تفاصيل جلسة سابقة ===================== */

async function openSessionDetail(sessionId) {
  const session = await window.DB.Sessions.getById(sessionId);
  const scenario = await window.DB.Scenarios.getById(session.scenarioId);
  const container = $('#session-detail-container');
  container.innerHTML = '';

  container.appendChild(
    el('div', { class: 'card' }, [
      el('h3', {}, scenario ? scenario.contextLabel : 'حوار محذوف'),
      el('p', { class: 'text-sm' }, `${new Date(session.startedAt).toLocaleString('ar')} · ${session.completed ? 'مكتملة' : 'غير مكتملة'}`),
    ])
  );

  if (session.transcript.length === 0) {
    container.appendChild(
      el('div', { class: 'empty-state' }, [el('p', {}, 'لا يوجد نص محادثة مسجَّل لهذه الجلسة')])
    );
  }

  session.transcript.forEach((entry) => {
    const matchPct = Math.round((entry.matchPercent || 0) * 100);
    const pillClass = matchPct >= 50 ? 'pill-success' : 'pill-danger';
    container.appendChild(
      el('div', { class: 'transcript-entry' }, [
        el('div', { class: 'te-header' }, [
          el('span', { class: 'te-speaker' }, entry.speaker === 'user' ? 'أنت' : 'الذكاء الاصطناعي'),
          el('span', { class: `pill ${pillClass}` }, `${matchPct}%`),
        ]),
        el('div', { class: 'te-expected en' }, entry.expectedText),
        entry.actualText ? el('div', { class: 'te-actual en' }, `سُمِع: ${entry.actualText}`) : null,
      ])
    );
  });

  navigateTo('session-detail');
}

$('#btn-back-from-detail').addEventListener('click', () => navigateTo('dialogues'));

/* ===================== الجلسة الصوتية الحيّة ===================== */

const VOICE_STATE_LABELS = {
  idle: 'اضغط "ابدأ" للانطلاق',
  listening: 'دورك الآن — اضغط للتحدث ثم اضغط مجددًا عند الانتهاء',
  thinking: 'جاري تحليل ما قلته...',
  'ai-speaking': 'الذكاء الاصطناعي يتحدث...',
  'ai-correcting': 'جاري توضيح النطق الصحيح...',
  completed: 'أحسنت! انتهى الحوار 🎉',
};

async function startLiveSession(scenario) {
  navigateTo('live-session');
  $('#live-session-title').textContent = scenario.contextLabel;
  $('#session-notice-container').innerHTML = '';
  $('#session-progress-fill').style.width = '0%';
  $('#btn-start-session').style.display = 'inline-flex';
  $('#btn-mic-toggle').style.display = 'none';
  $('#live-transcript-line').innerHTML = '<p class="en">اضغط ابدأ لعرض أول جملة</p>';

  const canvas = $('#voice-orb-canvas');
  App.voiceOrb = new VoiceOrb(canvas);
  App.voiceOrb.setState('idle');
  App.voiceOrb.start();
  setVoiceStateLabel('idle');

  const dbSession = await window.DB.Sessions.create(scenario.id);
  App.activeSessionId = dbSession.id;
  App.sessionStartTime = Date.now();
  await window.DB.Progress.updateToday({ scenariosStarted: 1 });

  $('#btn-start-session').onclick = async () => {
    const hasMicPermission = await ensureMicPermission();
    if (!hasMicPermission) return;

    $('#btn-start-session').style.display = 'none';
    $('#btn-mic-toggle').style.display = 'flex';
    $('#btn-mic-toggle').disabled = true;

    try {
      const session = new GeminiLiveSession({
        apiKey: App.settings.apiKey,
        scriptLines: scenario.scriptLines,
        voiceStyle: App.settings.voiceStyle,
        callbacks: {
          onStateChange: (state) => handleLiveStateChange(state, scenario),
          onListeningStarted: () => {
            $('#btn-mic-toggle').disabled = false;
            $('#btn-mic-toggle').classList.add('recording');
          },
          onTranscriptLine: (line) => handleTranscriptLine(line, scenario),
          onNeedsReview: (expectedText) => {
            $('#session-notice-container').appendChild(
              el('div', { class: 'card', style: 'background: var(--warning-soft); border:none;' }, [
                el('p', { class: 'text-sm' }, `تحتاج مراجعة: `),
                el('p', { class: 'en', style: 'font-weight:600;' }, expectedText),
              ])
            );
          },
          onError: (err) => showToast(err.message || 'حدث خطأ في الجلسة'),
          onDone: () => finishLiveSession(scenario),
        },
      });

      App.liveSession = session;
      await session.start();
    } catch (err) {
      showToast('تعذّر بدء الجلسة الصوتية: ' + (err.message || ''));
      console.error(err);
      $('#btn-start-session').style.display = 'inline-flex';
      $('#btn-mic-toggle').style.display = 'none';
    }
  };
}

function setVoiceStateLabel(state) {
  $('#voice-state-label').textContent = VOICE_STATE_LABELS[state] || '';
}

function handleLiveStateChange(state, scenario) {
  if (App.voiceOrb) App.voiceOrb.setState(state);
  setVoiceStateLabel(state);

  const micBtn = $('#btn-mic-toggle');
  if (state === 'listening') {
    micBtn.classList.add('recording');
    micBtn.disabled = false;
  } else {
    micBtn.classList.remove('recording');
    if (state !== 'idle') micBtn.disabled = true;
  }

  if (App.liveSession) {
    const idx = Math.min(App.liveSession.currentLineIndex, scenario.scriptLines.length);
    const pct = Math.round((idx / scenario.scriptLines.length) * 100);
    $('#session-progress-fill').style.width = pct + '%';

    const currentLine = scenario.scriptLines[App.liveSession.currentLineIndex];
    if (currentLine) {
      $('#live-transcript-line').innerHTML = `<p class="en">${escapeHtml(currentLine.text)}</p>`;
    }
  }
}

async function handleTranscriptLine(line, scenario) {
  if (!App.activeSessionId) return;
  await window.DB.Sessions.appendTranscriptLine(App.activeSessionId, line);

  await window.DB.Progress.updateToday({ pronunciationScoreSample: line.matchPercent });

  // إذا كانت الكلمة ضمن كلمات اليوم/المراجعة المستخدمة في هذا السيناريو، سجّل الأداء
  if (line.speaker === 'user' && scenario.wordsUsed && scenario.wordsUsed.length > 0) {
    const wasCorrect = line.matchPercent >= 0.5;
    for (const wordId of scenario.wordsUsed) {
      const word = await window.DB.Words.getById(wordId);
      if (word && line.expectedText.toLowerCase().includes(word.text.toLowerCase())) {
        const wasNew = word.status === 'new';
        await window.DB.Words.recordUsage(wordId, wasCorrect);
        if (wasNew && wasCorrect) {
          await window.DB.Progress.updateToday({ newWordsLearned: 1 });
        }
      }
    }
  }
}

$('#btn-mic-toggle').addEventListener('click', () => {
  if (App.liveSession) {
    App.liveSession.finishUserTurn();
  }
});

async function finishLiveSession(scenario) {
  const durationSeconds = Math.round((Date.now() - App.sessionStartTime) / 1000);
  await window.DB.Sessions.complete(App.activeSessionId, durationSeconds);
  await window.DB.Progress.updateToday({
    dialogueMinutes: Math.round(durationSeconds / 60),
    scenariosCompleted: 1,
  });

  setVoiceStateLabel('completed');
  $('#btn-mic-toggle').style.display = 'none';

  const summaryBtn = el('button', { class: 'btn btn-primary btn-block', onclick: () => navigateTo('dialogues') }, 'رجوع للحوارات');
  $('#session-notice-container').appendChild(summaryBtn);

  showToast('أحسنت! تم حفظ الجلسة');
}

$('#btn-exit-session').addEventListener('click', () => {
  if (App.liveSession) {
    App.liveSession.stop();
    App.liveSession = null;
  }
  if (App.voiceOrb) {
    App.voiceOrb.stop();
    App.voiceOrb = null;
  }
  navigateTo('dialogues');
});

/* ===================== صلاحية المايكروفون ===================== */

async function ensureMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch (err) {
    return new Promise((resolve) => {
      const modal = $('#mic-permission-modal');
      modal.hidden = false;
      $('#btn-grant-mic').onclick = async () => {
        modal.hidden = true;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          resolve(true);
        } catch (e) {
          showToast('تم رفض إذن المايكروفون — لا يمكن بدء المحادثة الصوتية بدونه');
          resolve(false);
        }
      };
    });
  }
}

/* ===================== أحداث عامة إضافية ===================== */

function bindGlobalEvents() {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (App.settings.theme === 'auto') applyTheme('auto');
  });
}

/* ===================== صفحة التقدم ===================== */

async function renderProgressPage() {
  const [allWords, progressDaily, sessions] = await Promise.all([
    window.DB.Words.getAll(),
    window.DB.Progress.getAll(),
    window.DB.Sessions.getAll(),
  ]);

  const learnedCount = allWords.filter((w) => w.status === 'learned' || w.status === 'mastered').length;
  $('#stat-total-words').textContent = learnedCount;

  const totalMinutes = progressDaily.reduce((sum, p) => sum + (p.dialogueMinutes || 0), 0);
  $('#stat-total-minutes').textContent = totalMinutes;

  const scoresWithData = progressDaily.filter((p) => p.avgPronunciationScore != null);
  if (scoresWithData.length > 0) {
    const avg = scoresWithData.reduce((sum, p) => sum + p.avgPronunciationScore, 0) / scoresWithData.length;
    $('#stat-avg-pronunciation').textContent = Math.round(avg * 100) + '%';
  } else {
    $('#stat-avg-pronunciation').textContent = '—';
  }

  const started = sessions.length;
  const completed = sessions.filter((s) => s.completed).length;
  $('#stat-completion-rate').textContent = started > 0 ? Math.round((completed / started) * 100) + '%' : '—';

  if (progressDaily.length > 0) {
    window.AppCharts.renderWordsChart($('#words-chart'), progressDaily);
    window.AppCharts.renderPronunciationChart($('#pronunciation-chart'), progressDaily);
  }
}
