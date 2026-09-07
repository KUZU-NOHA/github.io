// 隊列間の機体割当（アサインメント）。
//
// 隊列 A から隊列 B へ遷移するとき、「どの機体がどの位置へ向かうか」を決める。
// 適当に順番どおり割り当てると軌道が交差して衝突リスクが跳ね上がるため、
// 総移動距離（二乗和）が最小になる 1 対 1 対応をハンガリアン法で求める。
//
// 計算量は O(n^3)。機数が多い場合は貪欲法にフォールバックする。

const HUNGARIAN_LIMIT = 300;

/**
 * ハンガリアン法（Jonker-Volgenant 版のポテンシャル利用実装）。
 * @param {number[][]} cost n×n のコスト行列
 * @returns {Int32Array} assign[i] = 行 i に割り当てられた列
 */
export function hungarian(cost) {
  const n = cost.length;
  const INF = Infinity;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);
  const way = new Int32Array(n + 1);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(INF);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const assign = new Int32Array(n);
  for (let j = 1; j <= n; j++) assign[p[j] - 1] = j - 1;
  return assign;
}

/** 近い順に確定させる貪欲法。最適ではないが機数が多くても実用速度で終わる。 */
function greedy(from, to) {
  const n = from.length;
  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = from[i].x - to[j].x;
      const dy = from[i].y - to[j].y;
      const dz = from[i].z - to[j].z;
      pairs.push([dx * dx + dy * dy + dz * dz, i, j]);
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const assign = new Int32Array(n).fill(-1);
  const usedTo = new Uint8Array(n);
  let done = 0;
  for (const [, i, j] of pairs) {
    if (done === n) break;
    if (assign[i] !== -1 || usedTo[j]) continue;
    assign[i] = j;
    usedTo[j] = 1;
    done++;
  }
  return assign;
}

/**
 * 隊列 from（機体順）から隊列 to（位置候補）への割当を求める。
 * @returns {Int32Array} assign[i] = 機体 i が向かう to のインデックス
 */
export function assignTargets(from, to) {
  const n = from.length;
  if (n === 0) return new Int32Array(0);
  if (n > HUNGARIAN_LIMIT) return greedy(from, to);

  const cost = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(n);
    const a = from[i];
    for (let j = 0; j < n; j++) {
      const b = to[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      row[j] = dx * dx + dy * dy + dz * dz;
    }
    cost[i] = row;
  }
  return hungarian(cost);
}
