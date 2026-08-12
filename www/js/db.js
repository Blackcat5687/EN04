/**
 * db.js — طبقة الوصول لقاعدة بيانات IndexedDB
 * يحتوي كل الجداول: words, wordLists, scenarios, sessions, progressDaily, settings
 */

const DB_NAME = 'english_live_db';
const DB_VERSION = 1;

const STORES = {
  words: 'words',
  wordLists: 'wordLists',
  scenarios: 'scenarios',
  sessions: 'sessions',
  progressDaily: 'progressDaily',
  settings: 'settings',
};

let dbInstance = null;

/** فتح/إنشاء قاعدة البيانات وجداولها */
function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORES.words)) {
        const wordsStore = db.createObjectStore(STORES.words, { keyPath: 'id', autoIncrement: true });
        wordsStore.createIndex('status', 'status', { unique: false });
        wordsStore.createIndex('dateAdded', 'dateAdded', { unique: false });
        wordsStore.createIndex('lastReviewed', 'lastReviewed', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.wordLists)) {
        db.createObjectStore(STORES.wordLists, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORES.scenarios)) {
        const scenariosStore = db.createObjectStore(STORES.scenarios, { keyPath: 'id', autoIncrement: true });
        scenariosStore.createIndex('type', 'type', { unique: false });
        scenariosStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.sessions)) {
        const sessionsStore = db.createObjectStore(STORES.sessions, { keyPath: 'id', autoIncrement: true });
        sessionsStore.createIndex('scenarioId', 'scenarioId', { unique: false });
        sessionsStore.createIndex('startedAt', 'startedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.progressDaily)) {
        db.createObjectStore(STORES.progressDaily, { keyPath: 'date' });
      }

      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
    };

    req.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    req.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

/** دالة عامة لتنفيذ transaction */
async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ===================== Words ===================== */

const WordsDB = {
  async add(word) {
    const db = await openDB();
    const tx = db.transaction(STORES.words, 'readwrite');
    const store = tx.objectStore(STORES.words);
    const record = {
      text: word.text,
      translation: word.translation,
      example: word.example || '',
      status: word.status || 'new', // new | saving | learned | mastered
      dateAdded: word.dateAdded || new Date().toISOString(),
      lastReviewed: word.lastReviewed || null,
      timesUsedCorrectly: word.timesUsedCorrectly || 0,
      timesUsedIncorrectly: word.timesUsedIncorrectly || 0,
    };
    const id = await reqToPromise(store.add(record));
    return { ...record, id };
  },

  async bulkAdd(words) {
    const db = await openDB();
    const tx = db.transaction(STORES.words, 'readwrite');
    const store = tx.objectStore(STORES.words);
    const results = [];
    for (const w of words) {
      const record = {
        text: w.text,
        translation: w.translation,
        example: w.example || '',
        status: 'new',
        dateAdded: new Date().toISOString(),
        lastReviewed: null,
        timesUsedCorrectly: 0,
        timesUsedIncorrectly: 0,
      };
      const id = await reqToPromise(store.add(record));
      results.push({ ...record, id });
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(results);
      tx.onerror = () => reject(tx.error);
    });
  },

  async update(id, changes) {
    const db = await openDB();
    const tx = db.transaction(STORES.words, 'readwrite');
    const store = tx.objectStore(STORES.words);
    const existing = await reqToPromise(store.get(id));
    if (!existing) throw new Error('Word not found: ' + id);
    const updated = { ...existing, ...changes };
    await reqToPromise(store.put(updated));
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(updated);
      tx.onerror = () => reject(tx.error);
    });
  },

  async delete(id) {
    return withStore(STORES.words, 'readwrite', (store) => store.delete(id));
  },

  async getAll() {
    return withStore(STORES.words, 'readonly', (store) => reqToPromise(store.getAll()));
  },

  async getById(id) {
    return withStore(STORES.words, 'readonly', (store) => reqToPromise(store.get(id)));
  },

  async getByStatus(status) {
    const db = await openDB();
    const tx = db.transaction(STORES.words, 'readonly');
    const store = tx.objectStore(STORES.words);
    const index = store.index('status');
    return reqToPromise(index.getAll(status));
  },

  /** يعيد كلمات لم تُراجَع مؤخرًا (للتكرار المتباعد البسيط) مرتبة تصاعديًا حسب آخر مراجعة */
  async getWordsForReview(limit = 10) {
    const all = await this.getAll();
    return all
      .filter((w) => w.status !== 'new')
      .sort((a, b) => {
        const aDate = a.lastReviewed ? new Date(a.lastReviewed).getTime() : 0;
        const bDate = b.lastReviewed ? new Date(b.lastReviewed).getTime() : 0;
        return aDate - bDate;
      })
      .slice(0, limit);
  },

  /** يحدّث حالة كلمة بناءً على أدائها الفعلي في المحادثات */
  async recordUsage(id, wasCorrect) {
    const word = await this.getById(id);
    if (!word) return null;
    const timesUsedCorrectly = word.timesUsedCorrectly + (wasCorrect ? 1 : 0);
    const timesUsedIncorrectly = word.timesUsedIncorrectly + (wasCorrect ? 0 : 1);
    let status = word.status;
    if (status === 'new') status = 'saving';
    if (timesUsedCorrectly >= 3 && timesUsedCorrectly > timesUsedIncorrectly * 2) status = 'learned';
    if (timesUsedCorrectly >= 6 && timesUsedIncorrectly === 0) status = 'mastered';
    return this.update(id, {
      timesUsedCorrectly,
      timesUsedIncorrectly,
      status,
      lastReviewed: new Date().toISOString(),
    });
  },
};

/* ===================== Word Lists (built-in) ===================== */

const WordListsDB = {
  async getAll() {
    return withStore(STORES.wordLists, 'readonly', (store) => reqToPromise(store.getAll()));
  },
  async seed(lists) {
    const db = await openDB();
    const tx = db.transaction(STORES.wordLists, 'readwrite');
    const store = tx.objectStore(STORES.wordLists);
    for (const list of lists) {
      store.put(list);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },
};

/* ===================== Scenarios ===================== */

const ScenariosDB = {
  async add(scenario) {
    const db = await openDB();
    const tx = db.transaction(STORES.scenarios, 'readwrite');
    const store = tx.objectStore(STORES.scenarios);
    const record = {
      type: scenario.type, // 'words' | 'fixed'
      scriptLines: scenario.scriptLines, // [{speaker, text}]
      wordsUsed: scenario.wordsUsed || [],
      contextLabel: scenario.contextLabel || '',
      createdAt: new Date().toISOString(),
    };
    const id = await reqToPromise(store.add(record));
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve({ ...record, id });
      tx.onerror = () => reject(tx.error);
    });
  },
  async getById(id) {
    return withStore(STORES.scenarios, 'readonly', (store) => reqToPromise(store.get(id)));
  },
  async getAll() {
    return withStore(STORES.scenarios, 'readonly', (store) => reqToPromise(store.getAll()));
  },
};

/* ===================== Sessions ===================== */

const SessionsDB = {
  async create(scenarioId) {
    const db = await openDB();
    const tx = db.transaction(STORES.sessions, 'readwrite');
    const store = tx.objectStore(STORES.sessions);
    const record = {
      scenarioId,
      transcript: [], // {speaker, expectedText, actualText, matchPercent, timestamp}
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationSeconds: 0,
      completed: false,
    };
    const id = await reqToPromise(store.add(record));
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve({ ...record, id });
      tx.onerror = () => reject(tx.error);
    });
  },

  async appendTranscriptLine(sessionId, line) {
    const db = await openDB();
    const tx = db.transaction(STORES.sessions, 'readwrite');
    const store = tx.objectStore(STORES.sessions);
    const session = await reqToPromise(store.get(sessionId));
    if (!session) throw new Error('Session not found');
    session.transcript.push({ ...line, timestamp: new Date().toISOString() });
    await reqToPromise(store.put(session));
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(session);
      tx.onerror = () => reject(tx.error);
    });
  },

  async complete(sessionId, durationSeconds) {
    const db = await openDB();
    const tx = db.transaction(STORES.sessions, 'readwrite');
    const store = tx.objectStore(STORES.sessions);
    const session = await reqToPromise(store.get(sessionId));
    if (!session) throw new Error('Session not found');
    session.completed = true;
    session.completedAt = new Date().toISOString();
    session.durationSeconds = durationSeconds;
    await reqToPromise(store.put(session));
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(session);
      tx.onerror = () => reject(tx.error);
    });
  },

  async getById(id) {
    return withStore(STORES.sessions, 'readonly', (store) => reqToPromise(store.get(id)));
  },

  async getAll() {
    return withStore(STORES.sessions, 'readonly', (store) => reqToPromise(store.getAll()));
  },
};

/* ===================== Progress Daily ===================== */

const ProgressDB = {
  async getByDate(date) {
    return withStore(STORES.progressDaily, 'readonly', (store) => reqToPromise(store.get(date)));
  },

  async getAll() {
    return withStore(STORES.progressDaily, 'readonly', (store) => reqToPromise(store.getAll()));
  },

  /** تحديث تراكمي لإحصائيات يوم معيّن */
  async updateToday(delta) {
    const today = new Date().toISOString().slice(0, 10);
    const db = await openDB();
    const tx = db.transaction(STORES.progressDaily, 'readwrite');
    const store = tx.objectStore(STORES.progressDaily);
    let record = await reqToPromise(store.get(today));
    if (!record) {
      record = {
        date: today,
        newWordsLearned: 0,
        dialogueMinutes: 0,
        avgPronunciationScore: null,
        pronunciationSamples: 0,
        scenariosStarted: 0,
        scenariosCompleted: 0,
      };
    }
    if (delta.newWordsLearned) record.newWordsLearned += delta.newWordsLearned;
    if (delta.dialogueMinutes) record.dialogueMinutes += delta.dialogueMinutes;
    if (delta.scenariosStarted) record.scenariosStarted += delta.scenariosStarted;
    if (delta.scenariosCompleted) record.scenariosCompleted += delta.scenariosCompleted;
    if (typeof delta.pronunciationScoreSample === 'number') {
      const prevTotal = (record.avgPronunciationScore || 0) * record.pronunciationSamples;
      record.pronunciationSamples += 1;
      record.avgPronunciationScore = (prevTotal + delta.pronunciationScoreSample) / record.pronunciationSamples;
    }
    await reqToPromise(store.put(record));
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  },
};

/* ===================== Settings ===================== */

const SettingsDB = {
  DEFAULTS: {
    apiKey: '',
    voiceStyle: 'Zephyr',
    theme: 'auto', // 'light' | 'dark' | 'auto'
    dailyWordGoal: 5,
    sentencesPerDialogueDefault: 10,
  },

  async getAll() {
    const rows = await withStore(STORES.settings, 'readonly', (store) => reqToPromise(store.getAll()));
    const result = { ...this.DEFAULTS };
    for (const row of rows) result[row.key] = row.value;
    return result;
  },

  async get(key) {
    const row = await withStore(STORES.settings, 'readonly', (store) => reqToPromise(store.get(key)));
    return row ? row.value : this.DEFAULTS[key];
  },

  async set(key, value) {
    return withStore(STORES.settings, 'readwrite', (store) => store.put({ key, value }));
  },

  async setMany(obj) {
    const db = await openDB();
    const tx = db.transaction(STORES.settings, 'readwrite');
    const store = tx.objectStore(STORES.settings);
    for (const [key, value] of Object.entries(obj)) {
      store.put({ key, value });
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },
};

/* ===================== Backup / Restore ===================== */

const BackupDB = {
  async exportAll() {
    const [words, scenarios, sessions, progressDaily, settings] = await Promise.all([
      WordsDB.getAll(),
      ScenariosDB.getAll(),
      SessionsDB.getAll(),
      ProgressDB.getAll(),
      SettingsDB.getAll(),
    ]);
    // لا تصدّر مفتاح API ضمن النسخة الاحتياطية القابلة للمشاركة
    const { apiKey, ...safeSettings } = settings;
    return {
      exportedAt: new Date().toISOString(),
      version: DB_VERSION,
      words,
      scenarios,
      sessions,
      progressDaily,
      settings: safeSettings,
    };
  },

  async importAll(data) {
    const db = await openDB();
    const storeNames = [STORES.words, STORES.scenarios, STORES.sessions, STORES.progressDaily, STORES.settings];
    const tx = db.transaction(storeNames, 'readwrite');

    if (Array.isArray(data.words)) {
      const store = tx.objectStore(STORES.words);
      store.clear();
      for (const w of data.words) {
        const { id, ...rest } = w;
        store.put(w.id !== undefined ? w : rest);
      }
    }
    if (Array.isArray(data.scenarios)) {
      const store = tx.objectStore(STORES.scenarios);
      store.clear();
      for (const s of data.scenarios) store.put(s);
    }
    if (Array.isArray(data.sessions)) {
      const store = tx.objectStore(STORES.sessions);
      store.clear();
      for (const s of data.sessions) store.put(s);
    }
    if (Array.isArray(data.progressDaily)) {
      const store = tx.objectStore(STORES.progressDaily);
      store.clear();
      for (const p of data.progressDaily) store.put(p);
    }
    if (data.settings && typeof data.settings === 'object') {
      const store = tx.objectStore(STORES.settings);
      for (const [key, value] of Object.entries(data.settings)) {
        if (key === 'apiKey') continue; // لا تستورد مفتاح API من نسخة مشتركة
        store.put({ key, value });
      }
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
};

window.DB = {
  openDB,
  Words: WordsDB,
  WordLists: WordListsDB,
  Scenarios: ScenariosDB,
  Sessions: SessionsDB,
  Progress: ProgressDB,
  Settings: SettingsDB,
  Backup: BackupDB,
};
