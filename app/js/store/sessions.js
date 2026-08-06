/**
 * ローカル保存（IndexedDB）
 *
 * ⚠️ プライバシー方針（要件定義書 7.4）
 * 体重・体脂肪率・心拍は要配慮性の高い個人情報として扱い、
 * 初期リリースでは一切サーバーに送信せずブラウザ内に閉じる。
 * エクスポートと全削除の手段を必ず提供する。
 */

const DB_NAME = 'vcycling';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_WEIGHTS = 'weights';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('このブラウザは IndexedDB に対応していません'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        const s = db.createObjectStore(STORE_SESSIONS, {
          keyPath: 'id',
          autoIncrement: true,
        });
        s.createIndex('startedAt', 'startedAt');
      }
      if (!db.objectStoreNames.contains(STORE_WEIGHTS)) {
        db.createObjectStore(STORE_WEIGHTS, { keyPath: 'date' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req?.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

/* ---------- 走行セッション ---------- */

export async function saveSession(session) {
  return tx(STORE_SESSIONS, 'readwrite', (s) => s.add(session));
}

export async function listSessions() {
  const all = await tx(STORE_SESSIONS, 'readonly', (s) => s.getAll());
  return (all ?? []).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

export async function deleteSession(id) {
  return tx(STORE_SESSIONS, 'readwrite', (s) => s.delete(id));
}

/* ---------- 体重記録 ---------- */

/** date は 'YYYY-MM-DD'。同日は上書きされる */
export async function saveWeight({ date, weightKg, bodyFatPct }) {
  return tx(STORE_WEIGHTS, 'readwrite', (s) =>
    s.put({ date, weightKg, bodyFatPct: bodyFatPct ?? null })
  );
}

export async function listWeights() {
  const all = await tx(STORE_WEIGHTS, 'readonly', (s) => s.getAll());
  return (all ?? []).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function deleteWeight(date) {
  return tx(STORE_WEIGHTS, 'readwrite', (s) => s.delete(date));
}

/* ---------- 集計 ---------- */

/** ISO週の月曜日を 'YYYY-MM-DD' で返す */
export function weekStart(dateLike) {
  const d = new Date(dateLike);
  const day = (d.getDay() + 6) % 7; // 月曜=0
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

/** 直近 days 日の消費カロリー合計 */
export function kcalWithin(sessions, days) {
  const since = Date.now() - days * 86400_000;
  return sessions
    .filter((s) => new Date(s.startedAt).getTime() >= since)
    .reduce((sum, s) => sum + (s.kcal || 0), 0);
}

/** 連続実施日数（今日または昨日から遡って途切れるまで） */
export function currentStreak(sessions) {
  if (sessions.length === 0) return 0;
  const days = new Set(sessions.map((s) => s.startedAt.slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  // 今日まだ乗っていない場合は昨日から数える
  if (!days.has(cursor.toISOString().slice(0, 10))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/* ---------- エクスポート / 全削除 ---------- */

export async function exportAll() {
  const [sessions, weights] = await Promise.all([listSessions(), listWeights()]);
  return { exportedAt: new Date().toISOString(), sessions, weights };
}

export async function clearAll() {
  await tx(STORE_SESSIONS, 'readwrite', (s) => s.clear());
  await tx(STORE_WEIGHTS, 'readwrite', (s) => s.clear());
}
