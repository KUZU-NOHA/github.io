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
import {
  buildUnlockCommand, buildSimGradeCommand, buildSimModeCommand, buildErgCommand,
} from '../app/js/ble/wahoo.js';
import { parseCscMeasurement } from '../app/js/ble/csc.js';
import { parseCyclingPowerMeasurement } from '../app/js/ble/cyclingPower.js';
import {
  speedFromPower, powerRequired, RevolutionCounter, Smoother,
  speedFromWheel, cadenceFromCrank, isPlausibleSpeed, isPlausibleCadence,
} from '../app/js/ride/physics.js';
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

/* ============ CSC (0x1816) ============ */

test('CSC: ホイールとクランクの両方を読み出す', () => {
  // flags=0x03（両方あり）
  const bytes = new Uint8Array([
    0x03,
    0x10, 0x00, 0x00, 0x00,  // 累積ホイール回転 16
    0x00, 0x04,              // ホイールイベント時刻 1024 (=1秒)
    0x20, 0x00,              // 累積クランク回転 32
    0x00, 0x08,              // クランクイベント時刻 2048 (=2秒)
  ]);
  const d = parseCscMeasurement(new DataView(bytes.buffer));
  assert.equal(d.cumulativeWheelRevs, 16);
  assert.equal(d.lastWheelEventTime, 1024);
  assert.equal(d.cumulativeCrankRevs, 32);
  assert.equal(d.lastCrankEventTime, 2048);
});

test('CSC: クランクのみの機種を正しく読む（ホイール分ずれない）', () => {
  const bytes = new Uint8Array([0x02, 0x20, 0x00, 0x00, 0x04]);
  const d = parseCscMeasurement(new DataView(bytes.buffer));
  assert.equal(d.cumulativeWheelRevs, undefined);
  assert.equal(d.cumulativeCrankRevs, 32);
  assert.equal(d.lastCrankEventTime, 1024);
});

/* ============ Cycling Power (0x1818) ============ */

test('Cycling Power: パワーのみ（フラグ0）を読む', () => {
  const bytes = new Uint8Array([0x00, 0x00, 0xfa, 0x00]); // 250 W
  const d = parseCyclingPowerMeasurement(new DataView(bytes.buffer));
  assert.equal(d.powerW, 250);
});

test('Cycling Power: パワー + クランク回転（ケイデンス取得の主経路）', () => {
  // flags bit5 = クランク回転データあり
  const bytes = new Uint8Array([
    0x20, 0x00,        // flags
    0xfa, 0x00,        // 250 W
    0x40, 0x00,        // 累積クランク回転 64
    0x00, 0x04,        // クランクイベント時刻 1024
  ]);
  const d = parseCyclingPowerMeasurement(new DataView(bytes.buffer));
  assert.equal(d.powerW, 250);
  assert.equal(d.cumulativeCrankRevs, 64);
  assert.equal(d.lastCrankEventTime, 1024);
});

test('Cycling Power: ホイール+クランク両方でもオフセットがずれない', () => {
  // flags bit4 + bit5
  const bytes = new Uint8Array([
    0x30, 0x00,
    0xc8, 0x00,                    // 200 W
    0x0a, 0x00, 0x00, 0x00,        // ホイール回転 10 (uint32)
    0x00, 0x08,                    // ホイールイベント時刻 2048
    0x14, 0x00,                    // クランク回転 20
    0x00, 0x04,                    // クランクイベント時刻 1024
  ]);
  const d = parseCyclingPowerMeasurement(new DataView(bytes.buffer));
  assert.equal(d.powerW, 200);
  assert.equal(d.cumulativeWheelRevs, 10);
  assert.equal(d.lastWheelEventTime, 2048);
  assert.equal(d.cumulativeCrankRevs, 20);
  assert.equal(d.lastCrankEventTime, 1024);
});

test('Cycling Power: 前方に可変長フィールドがあってもクランクを正しく読む', () => {
  // bit0(バランス) + bit2(トルク) + bit5(クランク)
  const bytes = new Uint8Array([
    0x25, 0x00,
    0xfa, 0x00,        // 250 W
    0x64,              // バランス 100 → 50%
    0x00, 0x02,        // 累積トルク
    0x40, 0x00,        // クランク回転 64
    0x00, 0x04,        // 時刻 1024
  ]);
  const d = parseCyclingPowerMeasurement(new DataView(bytes.buffer));
  assert.equal(d.powerW, 250);
  assert.equal(d.pedalPowerBalance, 50);
  assert.equal(d.cumulativeCrankRevs, 64);
});

/* ============ Wahoo 独自トレーナー制御 ============ */

test('Wahoo: 解除コマンド', () => {
  assert.deepEqual([...buildUnlockCommand()], [0x20, 0xee, 0xfc]);
});

test('Wahoo: 勾配0%は中央値になる', () => {
  // 仕様: (grade + 1.0) × 65535 ÷ 2。勾配0 なら 32767.5 → 32768
  const cmd = buildSimGradeCommand(0);
  assert.equal(cmd[0], 0x46);
  const value = cmd[1] | (cmd[2] << 8);
  assert.equal(value, 32768);
});

test('Wahoo: 上り勾配は中央値より大きく、下りは小さくなる', () => {
  const climb = buildSimGradeCommand(5);
  const descent = buildSimGradeCommand(-5);
  const v = (c) => c[1] | (c[2] << 8);
  assert.ok(v(climb) > 32768, `上り: ${v(climb)}`);
  assert.ok(v(descent) < 32768, `下り: ${v(descent)}`);
  // 5% は 0.05 → (1.05 × 65535) / 2 = 34406
  assert.equal(v(climb), 34406);
});

test('Wahoo: 安全のため勾配を ±25% に丸める', () => {
  const v = (c) => c[1] | (c[2] << 8);
  // 想定外の値が来ても負荷が跳ね上がらないこと
  assert.equal(v(buildSimGradeCommand(999)), v(buildSimGradeCommand(25)));
  assert.equal(v(buildSimGradeCommand(-999)), v(buildSimGradeCommand(-25)));
});

test('Wahoo: SIM モードの前提条件をエンコードする', () => {
  const cmd = buildSimModeCommand(80, 0.004, 0.51);
  assert.equal(cmd[0], 0x43);
  assert.equal(cmd.length, 7);
  assert.equal(cmd[1] | (cmd[2] << 8), 8000);  // 体重 80kg × 100
  assert.equal(cmd[3] | (cmd[4] << 8), 4);     // crr 0.004 × 1000
  assert.equal(cmd[5] | (cmd[6] << 8), 510);   // cwr 0.51 × 1000
});

test('Wahoo: ERG モードの目標パワー', () => {
  const cmd = buildErgCommand(250);
  assert.equal(cmd[0], 0x42);
  assert.equal(cmd[1] | (cmd[2] << 8), 250);
});

/* ============ 走行物理 ============ */

test('speedFromPower: 平地 200W で 30km/h 前後になる', () => {
  const kmh = speedFromPower(200, 0, 80);
  assert.ok(kmh > 26 && kmh < 34, `実際: ${kmh}`);
});

test('speedFromPower: 同じパワーでも上り坂では遅くなる', () => {
  const flat = speedFromPower(200, 0, 80);
  const climb = speedFromPower(200, 5, 80);
  assert.ok(climb < flat / 2, `平地 ${flat} / 5%坂 ${climb}`);
});

test('speedFromPower: 5%勾配の登坂速度が実走と整合する', () => {
  // 総重量80kg・200W（2.5 W/kg）・5%勾配。
  // 登坂の目安 VAM ≒ (W/kg) × 352 m/h から水平速度は 17km/h 前後で、
  // 空気抵抗を含めると 15km/h 台に落ちる。
  const kmh = speedFromPower(200, 5, 80);
  assert.ok(kmh > 13 && kmh < 18, `実際: ${kmh}`);
});

test('speedFromPower: 平地の速度が実走と整合する', () => {
  // 200W で 32〜35km/h（CdA 0.32 のロードバイク相当）
  const kmh = speedFromPower(200, 0, 80);
  assert.ok(kmh > 31 && kmh < 36, `実際: ${kmh}`);
});

test('speedFromPower: 重い人ほど登坂は遅く、平地では差が小さい', () => {
  const lightClimb = speedFromPower(200, 5, 65);
  const heavyClimb = speedFromPower(200, 5, 95);
  assert.ok(lightClimb > heavyClimb, `軽 ${lightClimb} / 重 ${heavyClimb}`);

  const lightFlat = speedFromPower(200, 0, 65);
  const heavyFlat = speedFromPower(200, 0, 95);
  assert.ok(Math.abs(lightFlat - heavyFlat) < 2, `軽 ${lightFlat} / 重 ${heavyFlat}`);
});

test('speedFromPower: パワー0や不正値では 0', () => {
  assert.equal(speedFromPower(0, 0, 80), 0);
  assert.equal(speedFromPower(-50, 0, 80), 0);
  assert.equal(speedFromPower(NaN, 0, 80), 0);
});

test('powerRequired: 登坂ぶんのパワーが加算される', () => {
  const flat = powerRequired(8, 0, 80);
  const climb = powerRequired(8, 5, 80);
  assert.ok(climb > flat, `平地 ${flat} / 坂 ${climb}`);
});

test('RevolutionCounter: 回転数/秒を算出する', () => {
  const c = new RevolutionCounter({ timeResolution: 1024 });
  assert.equal(c.update(0, 0), null);           // 初回は基準を取るだけ
  const rps = c.update(10, 1024);               // 1秒で10回転
  assert.ok(Math.abs(rps - 10) < 0.001, `実際: ${rps}`);
});

test('RevolutionCounter: 測定窓が短すぎるうちは値を跳ねさせない', () => {
  // 通知間隔が 10ms で回転1回だと、素朴に割ると毎秒100回転になってしまう。
  // これが「速度が異常な値になる」原因なので、窓がたまるまで保持する。
  const c = new RevolutionCounter({ timeResolution: 1024, minIntervalSec: 0.5 });
  c.update(0, 0);
  assert.equal(c.update(1, 10), null, '窓が足りない間は前回値（初回は null）');
  assert.equal(c.update(2, 20), null);
  // 0.5秒を超えたところで初めて算出する（累積 使用: 512/1024 = 0.5秒で 5回転）
  const rps = c.update(5, 512);
  assert.ok(Math.abs(rps - 10) < 0.01, `実際: ${rps}`);
});

test('RevolutionCounter: 算出後は次の窓がたまるまで直前値を保持する', () => {
  const c = new RevolutionCounter({ timeResolution: 1024, minIntervalSec: 0.5 });
  c.update(0, 0);
  const first = c.update(10, 1024);
  assert.ok(Math.abs(first - 10) < 0.01);
  // すぐ次の通知が来ても値が暴れない
  assert.equal(c.update(11, 1034), first);
});

test('RevolutionCounter: uint16 の時刻巻き戻りを補正する', () => {
  const c = new RevolutionCounter({ timeResolution: 1024 });
  c.update(0, 65000);
  // 65000 → 512 は巻き戻り。実際は (65536-65000+512)/1024 ≒ 1.03 秒
  const rps = c.update(10, 512);
  assert.ok(rps > 9 && rps < 11, `実際: ${rps}`);
});

test('RevolutionCounter: 時刻が進まない再通知では null を返す', () => {
  const c = new RevolutionCounter({ timeResolution: 1024 });
  c.update(10, 1024);
  assert.equal(c.update(10, 1024), null);
});

test('RevolutionCounter: 停止が続けば 0 を返す', () => {
  const c = new RevolutionCounter({ timeResolution: 1024 });
  c.update(10, 1024);
  let last = null;
  for (let i = 0; i < 10; i++) last = c.update(10, 1024);
  assert.equal(last, 0);
});

test('speedFromWheel: 周長 2105mm で毎秒5回転なら約37.9km/h', () => {
  const kmh = speedFromWheel(5, 2105);
  assert.ok(Math.abs(kmh - 37.89) < 0.1, `実際: ${kmh}`);
  assert.equal(speedFromWheel(null, 2105), null);
});

test('cadenceFromCrank: 毎秒1.5回転なら 90rpm', () => {
  assert.equal(cadenceFromCrank(1.5), 90);
  assert.equal(cadenceFromCrank(null), null);
});

/* ============ 平滑化と外れ値の除去 ============ */

test('Smoother: 初回はそのまま、以降は徐々に追従する', () => {
  const s = new Smoother(2.0);
  assert.equal(s.update(30, 0), 30);
  // 1秒後に 0 が来ても一気に 0 にはならない
  const after = s.update(0, 1000);
  assert.ok(after > 0 && after < 30, `実際: ${after}`);
});

test('Smoother: 時間が経つほど新しい値へ強く追従する', () => {
  const quick = new Smoother(2.0);
  quick.update(0, 0);
  const shortStep = quick.update(100, 200);   // 0.2秒後

  const slow = new Smoother(2.0);
  slow.update(0, 0);
  const longStep = slow.update(100, 5000);    // 5秒後

  assert.ok(longStep > shortStep, `0.2秒: ${shortStep} / 5秒: ${longStep}`);
  assert.ok(longStep > 90, `5秒後はほぼ追いつく: ${longStep}`);
});

test('Smoother: 平滑化だけでは大きな外れ値に引きずられる（変化率制限が要る根拠）', () => {
  const s = new Smoother(2.5); // 変化率制限なし
  for (let t = 0; t < 5; t++) s.update(25, t * 1000);
  const v = s.update(300, 5200);
  assert.ok(v > 100, `平滑化のみだと ${v} まで跳ねる`);
});

test('Smoother: 変化率制限があれば単発スパイクが表示を支配しない', () => {
  const s = new Smoother(2.5, 10); // 10 km/h/秒（実機の設定と同じ）
  s.update(25, 0);
  s.update(25, 1000);
  // 直前の更新から 0.2秒後にノイズ 300km/h が1回混ざっても、
  // 増分は 10 × 0.2 = 2km/h までに抑えられる
  const v = s.update(300, 1200);
  assert.ok(v <= 27.01, `実際: ${v}`);
});

test('Smoother: 変化率制限は正常な加減速を妨げない', () => {
  const s = new Smoother(0.5, 10);
  s.update(20, 0);
  // 3秒かけて 20→30km/h（毎秒3.3km/h）は実走で普通に起こる。追随できること
  let v = 20;
  for (let t = 1; t <= 6; t++) v = s.update(30, t * 500);
  assert.ok(v > 29, `実際: ${v}`);
});

test('Smoother: 減速側にも変化率制限が効く', () => {
  const s = new Smoother(2.5, 10);
  s.update(30, 0);
  s.update(30, 1000);
  const v = s.update(0, 1200); // 0.2秒で急停止の値が来た
  assert.ok(v >= 27.99, `実際: ${v}`);
});

test('Smoother: 不正な値は無視して直前値を保つ', () => {
  const s = new Smoother(2.0);
  s.update(25, 0);
  assert.equal(s.update(NaN, 1000), 25);
});

test('isPlausibleSpeed: 現実にありえない速度を弾く', () => {
  assert.equal(isPlausibleSpeed(30), true);
  assert.equal(isPlausibleSpeed(0), true);
  assert.equal(isPlausibleSpeed(500), false);   // 内部カウントを誤って換算した値
  assert.equal(isPlausibleSpeed(-5), false);
  assert.equal(isPlausibleSpeed(NaN), false);
});

test('isPlausibleCadence: 現実にありえないケイデンスを弾く', () => {
  assert.equal(isPlausibleCadence(90), true);
  assert.equal(isPlausibleCadence(400), false);
  assert.equal(isPlausibleCadence(-1), false);
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
