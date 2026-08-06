/**
 * 純粋ロジックの単体テスト（Node で実行 / ブラウザ不要）
 *
 *   node --test test/unit.mjs
 *
 * FTMS のバイトレイアウトは実機なしでは間違いに気づけないため、
 * 既知のバイト列を流して期待値と突き合わせる。特に Flags bit 0 の
 * 論理反転（要件定義書 5.2 の警告）は必ず検証する。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  haversine, bearing, decodePolyline, buildPath, pointAt,
  elevationAt, gradeAt, resample, lerpAngle, normalizeAngle,
} from '../app/js/map/geo.js';
import {
  parseIndoorBikeData, buildSimulationCommand, parseFeatureFlags,
} from '../app/js/ble/ftms.js';
import { parseHeartRate } from '../app/js/ble/heartRate.js';
import {
  kcalFromPower, kcalFromMet, estimateMet, zoneFor, maxHeartRate,
  CalorieAccumulator,
} from '../app/js/ride/calories.js';
import { expandToPathPoints } from '../app/js/map/route.js';
import { RideEngine } from '../app/js/ride/engine.js';
import { currentStreak, kcalWithin } from '../app/js/store/sessions.js';

/* ============ 地理計算 ============ */

test('haversine: 東京駅〜横浜駅は約27km', () => {
  const d = haversine({ lat: 35.6812, lng: 139.7671 }, { lat: 35.4658, lng: 139.6222 });
  assert.ok(d > 26000 && d < 29000, `実際: ${d}`);
});

test('bearing: 真北・真東を正しく返す', () => {
  assert.ok(Math.abs(bearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 0) < 0.01);
  assert.ok(Math.abs(bearing({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 90) < 0.01);
});

test('normalizeAngle / lerpAngle: 360度の折返しを最短で回る', () => {
  assert.equal(normalizeAngle(370), 10);
  assert.equal(normalizeAngle(-190), 170);
  // 350度 → 10度 は +20度側に回るべき（-340度側ではない）
  const mid = lerpAngle(350, 10, 0.5);
  assert.ok(Math.abs(mid - 0) < 0.001 || Math.abs(mid - 360) < 0.001, `実際: ${mid}`);
});

test('decodePolyline: Google のリファレンス値を復元できる', () => {
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.equal(pts.length, 3);
  assert.ok(Math.abs(pts[0].lat - 38.5) < 1e-5);
  assert.ok(Math.abs(pts[0].lng - -120.2) < 1e-5);
  assert.ok(Math.abs(pts[2].lat - 43.252) < 1e-5);
  assert.ok(Math.abs(pts[2].lng - -126.453) < 1e-5);
});

test('buildPath: 累積距離を正しく積む', () => {
  const path = buildPath([
    { lat: 35.0, lng: 139.0 },
    { lat: 35.01, lng: 139.0 },
    { lat: 35.02, lng: 139.0 },
  ]);
  assert.equal(path.cumulative[0], 0);
  assert.ok(path.cumulative[1] > 1000 && path.cumulative[1] < 1200);
  // 等間隔なので合計は1区間のちょうど2倍になるはず
  assert.ok(Math.abs(path.totalDistanceM - path.cumulative[1] * 2) < 1);
});

test('buildPath: 重複点を除去する（距離0区間で方位が壊れるのを防ぐ）', () => {
  const path = buildPath([
    { lat: 35.0, lng: 139.0 },
    { lat: 35.0, lng: 139.0 },
    { lat: 35.01, lng: 139.0 },
  ]);
  assert.equal(path.points.length, 2);
});

test('buildPath: 2点未満は例外', () => {
  assert.throws(() => buildPath([{ lat: 35, lng: 139 }]));
});

test('pointAt: 中間地点を補間し、範囲外は端に張り付く', () => {
  const path = buildPath([
    { lat: 35.0, lng: 139.0 },
    { lat: 35.02, lng: 139.0 },
  ]);
  const mid = pointAt(path, path.totalDistanceM / 2);
  assert.ok(Math.abs(mid.lat - 35.01) < 1e-4, `実際: ${mid.lat}`);

  const over = pointAt(path, path.totalDistanceM * 5);
  assert.ok(Math.abs(over.lat - 35.02) < 1e-6);

  const under = pointAt(path, -500);
  assert.ok(Math.abs(under.lat - 35.0) < 1e-6);
});

test('elevationAt / gradeAt: 上り勾配を正しく算出する', () => {
  // 約1.1km で 100m 上る ≒ 9%
  const path = buildPath([
    { lat: 35.0, lng: 139.0 },
    { lat: 35.01, lng: 139.0 },
  ]);
  const elevations = [0, 100];
  const half = elevationAt(path, elevations, path.totalDistanceM / 2);
  assert.ok(Math.abs(half - 50) < 1, `実際: ${half}`);

  const g = gradeAt(path, elevations, path.totalDistanceM / 2);
  assert.ok(g > 8 && g < 10, `実際: ${g}`);
});

test('gradeAt: 標高データが無ければ 0 を返す（走行は継続できる）', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.01, lng: 139 }]);
  assert.equal(gradeAt(path, [], 100), 0);
  assert.equal(gradeAt(path, null, 100), 0);
});

test('gradeAt: 非現実的な急勾配は ±25% に丸める', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.0002, lng: 139 }]);
  const g = gradeAt(path, [0, 1000], 10);
  assert.ok(g <= 25 && g >= -25, `実際: ${g}`);
});

test('resample: 指定点数で等間隔にリサンプルする', () => {
  const path = buildPath([
    { lat: 35.0, lng: 139.0 },
    { lat: 35.05, lng: 139.0 },
  ]);
  const pts = resample(path, 11);
  assert.equal(pts.length, 11);
  assert.ok(Math.abs(pts[5].lat - 35.025) < 1e-4);
  // Elevation API の上限を超えない
  assert.equal(resample(path, 9999).length, 512);
});

test('expandToPathPoints: 間引いた標高を元の点数へ戻す', () => {
  assert.deepEqual(expandToPathPoints([0, 10], 3), [0, 5, 10]);
  assert.equal(expandToPathPoints([], 5).length, 0);
  assert.deepEqual(expandToPathPoints([1, 2, 3], 3), [1, 2, 3]);
});

/* ============ FTMS: Indoor Bike Data ============ */

/** フラグとフィールドからテスト用のバイト列を組み立てる */
function buildIndoorBikeData(flags, fields) {
  const bytes = [flags & 0xff, (flags >> 8) & 0xff, ...fields];
  return new DataView(new Uint8Array(bytes).buffer);
}

test('Indoor Bike Data: bit0=0 のとき瞬間速度が存在する（論理反転）', () => {
  // flags=0x0000 → More Data が 0 なので速度あり。3000 * 0.01 = 30.00 km/h
  const view = buildIndoorBikeData(0x0000, [0xb8, 0x0b]);
  const d = parseIndoorBikeData(view);
  assert.equal(d.speedKmh, 30);
});

test('Indoor Bike Data: bit0=1 のとき瞬間速度は存在しない', () => {
  // flags=0x0005 → bit0=1（速度なし）, bit2=1（ケイデンスあり）
  // ケイデンスが先頭に来る。180 * 0.5 = 90 rpm
  const view = buildIndoorBikeData(0x0005, [0xb4, 0x00]);
  const d = parseIndoorBikeData(view);
  assert.equal(d.speedKmh, undefined);
  assert.equal(d.cadenceRpm, 90);
});

test('Indoor Bike Data: 速度+ケイデンス+パワーの複合ケース', () => {
  // flags: bit0=0(速度あり), bit2(ケイデンス), bit6(パワー) → 0x0044
  const view = buildIndoorBikeData(0x0044, [
    0xb8, 0x0b,  // 速度 3000 → 30.00 km/h
    0xb4, 0x00,  // ケイデンス 180 → 90 rpm
    0xfa, 0x00,  // パワー 250 W
  ]);
  const d = parseIndoorBikeData(view);
  assert.equal(d.speedKmh, 30);
  assert.equal(d.cadenceRpm, 90);
  assert.equal(d.powerW, 250);
});

test('Indoor Bike Data: 全フィールドを順序どおり読み出せる', () => {
  const flags = 0x1ffe | 0x0000; // bit0=0(速度あり) + bit1〜bit12 すべて立てる
  const view = buildIndoorBikeData(flags, [
    0xb8, 0x0b,        // 瞬間速度 30.00 km/h
    0x88, 0x13,        // 平均速度 5000 → 50.00 km/h
    0xb4, 0x00,        // 瞬間ケイデンス 90 rpm
    0x64, 0x00,        // 平均ケイデンス 50 rpm
    0xe8, 0x03, 0x00,  // 総距離 uint24 = 1000 m
    0x05, 0x00,        // 抵抗レベル 5
    0xfa, 0x00,        // 瞬間パワー 250 W
    0xc8, 0x00,        // 平均パワー 200 W
    0x2c, 0x01,        // 総エネルギー 300 kcal
    0x90, 0x01,        // 時間あたり 400 kcal
    0x07,              // 分あたり 7 kcal
    0x8c,              // 心拍 140 bpm
    0x46,              // MET 70 → 7.0
    0x3c, 0x00,        // 経過 60 秒
    0x1e, 0x00,        // 残り 30 秒
  ]);
  const d = parseIndoorBikeData(view);
  assert.equal(d.speedKmh, 30);
  assert.equal(d.avgSpeedKmh, 50);
  assert.equal(d.cadenceRpm, 90);
  assert.equal(d.avgCadenceRpm, 50);
  assert.equal(d.totalDistanceM, 1000);
  assert.equal(d.resistanceLevel, 5);
  assert.equal(d.powerW, 250);
  assert.equal(d.avgPowerW, 200);
  assert.equal(d.totalEnergyKcal, 300);
  assert.equal(d.energyPerHourKcal, 400);
  assert.equal(d.energyPerMinuteKcal, 7);
  assert.equal(d.heartRateBpm, 140);
  assert.ok(Math.abs(d.metabolicEquivalent - 7) < 1e-9);
  assert.equal(d.elapsedTimeS, 60);
  assert.equal(d.remainingTimeS, 30);
});

test('Indoor Bike Data: uint24 の総距離を正しく組み立てる', () => {
  // bit0=1(速度なし) + bit4(総距離) = 0x0011。0x010000 = 65536 m
  const view = buildIndoorBikeData(0x0011, [0x00, 0x00, 0x01]);
  assert.equal(parseIndoorBikeData(view).totalDistanceM, 65536);
});

test('Indoor Bike Data: 負のパワー（下り）を sint16 として読む', () => {
  const view = buildIndoorBikeData(0x0041, [0xf6, 0xff]); // -10 W
  assert.equal(parseIndoorBikeData(view).powerW, -10);
});

/* ============ FTMS: Control Point ============ */

test('buildSimulationCommand: 勾配 5% を仕様どおりエンコードする', () => {
  const buf = buildSimulationCommand({ gradePercent: 5 });
  const v = new DataView(buf);
  assert.equal(buf.byteLength, 7);
  assert.equal(v.getUint8(0), 0x11);          // オペコード
  assert.equal(v.getInt16(1, true), 0);        // 風速 0
  assert.equal(v.getInt16(3, true), 500);      // 5% ÷ 0.01 = 500
  assert.equal(v.getUint8(5), 40);             // crr 0.004 ÷ 0.0001 = 40
  assert.equal(v.getUint8(6), 51);             // cw 0.51 ÷ 0.01 = 51
});

test('buildSimulationCommand: 下り勾配を負値としてエンコードする', () => {
  const v = new DataView(buildSimulationCommand({ gradePercent: -7.5 }));
  assert.equal(v.getInt16(3, true), -750);
});

test('buildSimulationCommand: uint8 の範囲を超える係数は飽和させる', () => {
  const v = new DataView(buildSimulationCommand({ crr: 1, cw: 10 }));
  assert.equal(v.getUint8(5), 255);
  assert.equal(v.getUint8(6), 255);
});

test('parseFeatureFlags: 対応機能ビットを読み出す', () => {
  const bytes = new Uint8Array(8);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, (1 << 1) | (1 << 14), true); // ケイデンス + パワー
  v.setUint32(4, 1 << 13, true);              // シミュレーション対応
  const f = parseFeatureFlags(v);
  assert.equal(f.cadence, true);
  assert.equal(f.power, true);
  assert.equal(f.simulation, true);
  assert.equal(f.resistanceLevel, false);
});

/* ============ 心拍 ============ */

test('parseHeartRate: 8bit / 16bit の両形式に対応する', () => {
  const v8 = new DataView(new Uint8Array([0x00, 0x8c]).buffer);
  assert.equal(parseHeartRate(v8).heartRateBpm, 140);

  const v16 = new DataView(new Uint8Array([0x01, 0x2c, 0x01]).buffer);
  assert.equal(parseHeartRate(v16).heartRateBpm, 300);
});

/* ============ カロリー ============ */

test('kcalFromPower: 200W × 60秒 = 12 kJ ≒ 12 kcal', () => {
  assert.equal(kcalFromPower(200, 60), 12);
});

test('kcalFromPower: 1時間 250W なら約900kcal（実走の感覚と一致する）', () => {
  const kcal = kcalFromPower(250, 3600);
  assert.equal(kcal, 900);
});

test('kcalFromPower: 不正値は 0 を返す', () => {
  assert.equal(kcalFromPower(0, 60), 0);
  assert.equal(kcalFromPower(NaN, 60), 0);
  assert.equal(kcalFromPower(200, 0), 0);
});

test('kcalFromMet: 7METs × 70kg × 1時間 ≒ 515 kcal', () => {
  const kcal = kcalFromMet(7, 70, 3600);
  assert.ok(Math.abs(kcal - 514.5) < 0.1, `実際: ${kcal}`);
});

test('estimateMet: 速度から強度を段階的に見積もる', () => {
  assert.equal(estimateMet({ speedKmh: 0, cadenceRpm: 0 }), 0);
  assert.equal(estimateMet({ speedKmh: 12 }), 5.5);
  assert.equal(estimateMet({ speedKmh: 20 }), 7.0);
  assert.equal(estimateMet({ speedKmh: 30 }), 10.5);
});

test('zoneFor: 脂肪燃焼ゾーン(Z2)を判定できる', () => {
  const age = 40;                     // 最大心拍 180
  assert.equal(maxHeartRate(age), 180);
  assert.equal(zoneFor(117, age).key, 'z2');   // 65%
  assert.equal(zoneFor(135, age).key, 'z3');   // 75%
  assert.equal(zoneFor(0, age), null);
});

test('CalorieAccumulator: パワーが来たら推定から実測へ切り替わる', () => {
  const acc = new CalorieAccumulator({ weightKg: 70 });
  acc.add({ speedKmh: 20, cadenceRpm: 80 }, 60);
  assert.equal(acc.method, 'met');
  assert.ok(acc.isEstimate);
  const afterMet = acc.kcal;
  assert.ok(afterMet > 0);

  acc.add({ powerW: 200, speedKmh: 20 }, 60);
  assert.equal(acc.method, 'power');
  assert.equal(acc.isEstimate, false);
  // MET ぶんは破棄されず引き継がれる
  assert.ok(acc.kcal > afterMet);
  assert.equal(acc.kj, 12);
});

/* ============ 走行エンジン ============ */

function makeStubSource() {
  const src = new EventTarget();
  src.supportsGrade = true;
  src.grades = [];
  src.setGrade = (g) => { src.grades.push(g); return Promise.resolve(true); };
  src.pause = () => {};
  src.resume = () => {};
  return src;
}

test('RideEngine: 速度から距離を積算する', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.1, lng: 139 }]);
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [] });

  engine.live.speedKmh = 36; // = 10 m/s
  engine.advance(1);
  assert.ok(Math.abs(engine.distanceM - 10) < 0.001, `実際: ${engine.distanceM}`);

  engine.advance(2);
  assert.ok(Math.abs(engine.distanceM - 30) < 0.001);
  assert.ok(Math.abs(engine.elapsedSec - 3) < 0.001);
});

test('RideEngine: 映像速度の倍率が距離に反映される', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.1, lng: 139 }]);
  const engine = new RideEngine({
    path, source: makeStubSource(), elevations: [], speedMultiplier: 2,
  });
  engine.live.speedKmh = 36;
  engine.advance(1);
  assert.ok(Math.abs(engine.distanceM - 20) < 0.001, `実際: ${engine.distanceM}`);
});

test('RideEngine: 勾配をデータ源へ送る', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.01, lng: 139 }]);
  const source = makeStubSource();
  const engine = new RideEngine({ path, source, elevations: [0, 100] });
  engine.live.speedKmh = 36;
  engine.advance(1);
  assert.ok(source.grades.length > 0);
  assert.ok(source.grades[0] > 5, `実際: ${source.grades[0]}`);
});

test('RideEngine: 勾配連動を切ると送信しない', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.01, lng: 139 }]);
  const source = makeStubSource();
  const engine = new RideEngine({
    path, source, elevations: [0, 100], gradeEnabled: false,
  });
  engine.live.speedKmh = 36;
  engine.advance(1);
  assert.equal(source.grades.length, 0);
});

test('RideEngine: パワーからカロリーを積算する', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 36, lng: 139 }]);
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [] });
  engine.live.powerW = 200;
  engine.live.speedKmh = 25;
  engine.advance(60);
  assert.ok(Math.abs(engine.calories.kcal - 12) < 0.001, `実際: ${engine.calories.kcal}`);
  assert.equal(engine.snapshot().calorieIsEstimate, false);
});

test('RideEngine: 終点に到達すると完走扱いになる', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.001, lng: 139 }]);
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [] });
  let finished = null;
  engine.addEventListener('finish', (e) => { finished = e.detail; });

  engine.live.speedKmh = 72; // 20 m/s
  engine.advance(60);        // 経路長(約111m)を大きく超える

  assert.equal(engine.state, 'finished');
  assert.equal(engine.distanceM, path.totalDistanceM);
  assert.ok(finished, '完走イベントが発火していない');
  assert.equal(finished.distanceM, Math.round(path.totalDistanceM));
});

test('RideEngine: loop 指定なら終点で先頭へ戻る', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.001, lng: 139 }]);
  const engine = new RideEngine({
    path, source: makeStubSource(), elevations: [], loop: true,
  });
  engine.live.speedKmh = 72;
  engine.advance(60);
  assert.notEqual(engine.state, 'finished');
  assert.ok(engine.distanceM < path.totalDistanceM);
});

test('RideEngine: 心拍ゾーンの滞在時間を積算する', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 36, lng: 139 }]);
  const engine = new RideEngine({
    path, source: makeStubSource(), elevations: [], age: 40,
  });
  engine.live.heartRateBpm = 117; // Z2
  engine.live.speedKmh = 20;
  engine.advance(10);
  assert.ok(Math.abs(engine.zoneSeconds.z2 - 10) < 0.001);
  assert.equal(engine.zoneSeconds.z4, 0);
});

test('RideEngine: 平均値と要約を算出する', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 36, lng: 139 }]);
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [] });
  engine.startedAt = new Date('2026-01-01T00:00:00Z');

  engine.live.powerW = 100;
  engine.live.speedKmh = 20;
  engine.advance(10);
  engine.live.powerW = 300;
  engine.advance(10);

  assert.ok(Math.abs(engine.avgPowerW - 200) < 0.001, `実際: ${engine.avgPowerW}`);
  const s = engine.summary();
  assert.equal(s.maxPowerW, 300);
  assert.equal(s.avgPowerW, 200);
  assert.ok(s.distanceM > 0);
  assert.equal(typeof s.startedAt, 'string');
});

test('RideEngine: dt が 0 以下なら何も進めない', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 36, lng: 139 }]);
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [] });
  engine.live.speedKmh = 30;
  engine.advance(0);
  engine.advance(-5);
  assert.equal(engine.distanceM, 0);
  assert.equal(engine.elapsedSec, 0);
});

/* ============ 集計 ============ */

test('currentStreak: 連続実施日数を数える', () => {
  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return { startedAt: d.toISOString() };
  };
  assert.equal(currentStreak([]), 0);
  assert.equal(currentStreak([day(0), day(1), day(2)]), 3);
  // 途中で1日空くとそこで止まる
  assert.equal(currentStreak([day(0), day(1), day(3)]), 2);
  // 今日未実施でも昨日から数える
  assert.equal(currentStreak([day(1), day(2)]), 2);
});

test('kcalWithin: 期間内のカロリーだけを合計する', () => {
  const mk = (offsetDays, kcal) => {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    return { startedAt: d.toISOString(), kcal };
  };
  const sessions = [mk(1, 300), mk(3, 200), mk(20, 500)];
  assert.equal(kcalWithin(sessions, 7), 500);
  assert.equal(kcalWithin(sessions, 30), 1000);
});
