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

/** 期間内のセッションの心拍ゾーン滞在時間を合計する（秒） */
export function zoneTotals(sessions, days = 7) {
  const since = Date.now() - days * 86400_000;
  const totals = {};
  for (const s of sessions) {
    if (new Date(s.startedAt).getTime() < since) continue;
    for (const [key, sec] of Object.entries(s.zoneSeconds ?? {})) {
      totals[key] = (totals[key] ?? 0) + sec;
    }
  }
  return totals;
}

/**
 * 体重の推移から目標達成日を予測する。
 *
 * 日々の体重は水分などで上下するため、単純な差分ではなく
 * 最小二乗法で傾きを求める。判断材料が足りないときは推測しない。
 *
 * @param {Array} weights listWeights() の戻り値（日付昇順）
 * @param {number} targetKg 目標体重
 * @returns {{status: string, date?: Date, daysLeft?: number, kgPerWeek?: number}}
 */
export function predictGoalDate(weights, targetKg) {
  if (!Number.isFinite(targetKg)) return { status: 'no-target' };
  if (weights.length < 4) return { status: 'need-more-data', need: 4 - weights.length };

  const t0 = new Date(weights[0].date).getTime();
  const points = weights.map((w) => ({
    x: (new Date(w.date).getTime() - t0) / 86400_000, // 経過日数
    y: w.weightKg,
  }));

  const spanDays = points[points.length - 1].x;
  if (spanDays < 7) return { status: 'need-more-days', need: Math.ceil(7 - spanDays) };

  // 最小二乗法で傾き（kg/日）を求める
  const n = points.length;
  const sumX = points.reduce((a, p) => a + p.x, 0);
  const sumY = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumXX = points.reduce((a, p) => a + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { status: 'need-more-data' };

  const slope = (n * sumXY - sumX * sumY) / denom;   // kg/日
  const intercept = (sumY - slope * sumX) / n;
  const current = slope * spanDays + intercept;      // 回帰直線上の現在値

  const remaining = targetKg - current;
  if (Math.abs(remaining) < 0.3) return { status: 'reached' };

  // 目標に近づく向きに変化しているか
  if (slope === 0 || Math.sign(remaining) !== Math.sign(slope)) {
    return { status: 'not-approaching', kgPerWeek: slope * 7 };
  }

  const daysLeft = remaining / slope;
  // 何年も先の予測は実用的でないので出さない
  if (daysLeft > 730) return { status: 'too-far', kgPerWeek: slope * 7 };

  const date = new Date(Date.now() + daysLeft * 86400_000);
  return {
    status: 'ok',
    date,
    daysLeft: Math.ceil(daysLeft),
    kgPerWeek: slope * 7,
  };
}

/* ---------- エクスポート / 全削除 ---------- */

/** 走行記録を CSV にする（表計算ソフトで開ける形式） */
export function sessionsToCsv(sessions) {
  const header = [
    '日時', 'ルート', '距離km', '時間秒', '消費kcal', 'カロリー算出',
    '平均W', '最大W', '平均心拍', '平均速度kmh', '最高速度kmh',
    'Z1秒', 'Z2秒', 'Z3秒', 'Z4秒', 'Z5秒',
  ];
  const rows = sessions.map((s) => [
    s.startedAt,
    s.routeName ?? '',
    ((s.distanceM ?? 0) / 1000).toFixed(2),
    s.elapsedSec ?? 0,
    s.kcal ?? 0,
    s.calorieIsEstimate ? 'METs推定' : 'パワー実測',
    s.avgPowerW ?? 0,
    s.maxPowerW ?? 0,
    s.avgHeartRateBpm ?? 0,
    s.avgSpeedKmh ?? 0,
    s.maxSpeedKmh ?? 0,
    s.zoneSeconds?.z1 ?? 0,
    s.zoneSeconds?.z2 ?? 0,
    s.zoneSeconds?.z3 ?? 0,
    s.zoneSeconds?.z4 ?? 0,
    s.zoneSeconds?.z5 ?? 0,
  ]);
  return [header, ...rows]
    .map((r) => r.map(csvCell).join(','))
    .join('\n');
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportAll() {
  const [sessions, weights] = await Promise.all([listSessions(), listWeights()]);
  return { exportedAt: new Date().toISOString(), sessions, weights };
}

export async function clearAll() {
  await tx(STORE_SESSIONS, 'readwrite', (s) => s.clear());
  await tx(STORE_WEIGHTS, 'readwrite', (s) => s.clear());
}
