// 3D プレビュー。
//
// 外部ライブラリを使わず Canvas 2D で描画する。ドローンショーの見た目は
// 「暗い空に光る点」であり、点の投影とソートだけで十分に再現できるため、
// 依存ゼロ（＝オフラインでも動く・CDN 障害の影響を受けない）を優先した。
//
// 座標系は ENU（x = 東, y = 北, z = 高度）。カメラは注視点まわりの
// 方位角 / 仰角 / 距離で管理する。

const DEG = Math.PI / 180;

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = {
      azimuth: -90 * DEG, // -y 方向（観客席）から見る
      elevation: 12 * DEG,
      distance: 220,
      target: { x: 0, y: 0, z: 35 },
      fov: 55 * DEG,
    };
    this.options = {
      showGrid: true,
      showTrails: true,
      showGeofence: true,
      droneSize: 0.75,
      geofenceRadius: 90,
      maxAltitude: 100,
    };
    this.trails = [];
    this.trailLength = 22;
    this._frame = null;
    this._highlight = new Set();
    this._bindInput();
    this.resize();
  }

  setView(preset) {
    const c = this.camera;
    if (preset === 'audience') {
      c.azimuth = -90 * DEG; c.elevation = 12 * DEG; c.distance = 220;
      c.target = { x: 0, y: 0, z: 35 };
    } else if (preset === 'top') {
      c.azimuth = -90 * DEG; c.elevation = 88 * DEG; c.distance = 230;
      c.target = { x: 0, y: 0, z: 0 };
    } else if (preset === 'diagonal') {
      c.azimuth = -125 * DEG; c.elevation = 25 * DEG; c.distance = 240;
      c.target = { x: 0, y: 0, z: 40 };
    }
  }

  /** 衝突などで注目させたい機体を強調表示する。 */
  setHighlight(ids) {
    this._highlight = new Set(ids || []);
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.cssWidth = w;
    this.cssHeight = h;
    this.dpr = dpr;
  }

  _bindInput() {
    const c = this.canvas;
    let dragging = null;
    let last = { x: 0, y: 0 };

    const onDown = (e) => {
      dragging = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
      last = { x: e.clientX, y: e.clientY };
      c.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      const cam = this.camera;
      if (dragging === 'orbit') {
        cam.azimuth -= dx * 0.006;
        cam.elevation = Math.max(
          -80 * DEG,
          Math.min(89 * DEG, cam.elevation + dy * 0.005),
        );
      } else {
        // 画面右方向・上方向にそのままスライドさせる
        const s = cam.distance * 0.0016;
        const ca = Math.cos(cam.azimuth);
        const sa = Math.sin(cam.azimuth);
        cam.target.x -= (-sa * dx) * s;
        cam.target.y -= (ca * dx) * s;
        cam.target.z += dy * s;
      }
      this.render();
    };
    const onUp = () => { dragging = null; };

    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const cam = this.camera;
        cam.distance = Math.max(15, Math.min(900, cam.distance * (1 + Math.sign(e.deltaY) * 0.12)));
        this.render();
      },
      { passive: false },
    );
  }

  _viewBasis() {
    const c = this.camera;
    const ce = Math.cos(c.elevation);
    const eye = {
      x: c.target.x + c.distance * ce * Math.cos(c.azimuth),
      y: c.target.y + c.distance * ce * Math.sin(c.azimuth),
      z: c.target.z + c.distance * Math.sin(c.elevation),
    };
    const f = norm({ x: c.target.x - eye.x, y: c.target.y - eye.y, z: c.target.z - eye.z });
    const worldUp = { x: 0, y: 0, z: 1 };
    let r = cross(f, worldUp);
    if (len(r) < 1e-6) r = { x: 1, y: 0, z: 0 };
    r = norm(r);
    const u = cross(r, f);
    const focal = (this.cssHeight / 2) / Math.tan(c.fov / 2);
    return { eye, f, r, u, focal };
  }

  _project(p, basis) {
    const dx = p.x - basis.eye.x;
    const dy = p.y - basis.eye.y;
    const dz = p.z - basis.eye.z;
    const depth = dx * basis.f.x + dy * basis.f.y + dz * basis.f.z;
    if (depth <= 0.5) return null;
    const vx = dx * basis.r.x + dy * basis.r.y + dz * basis.r.z;
    const vy = dx * basis.u.x + dy * basis.u.y + dz * basis.u.z;
    const s = basis.focal / depth;
    return {
      sx: this.cssWidth / 2 + vx * s,
      sy: this.cssHeight / 2 - vy * s,
      depth,
      scale: s,
    };
  }

  /** 描画対象のフレームを差し替える。{pos, col} は sampleAt() の戻り値。 */
  setFrame(frame, resetTrails = false) {
    this._frame = frame;
    if (resetTrails || this.trails.length !== frame.pos.length) {
      this.trails = frame.pos.map(() => []);
    }
    if (this.options.showTrails) {
      for (let i = 0; i < frame.pos.length; i++) {
        const tr = this.trails[i];
        tr.push({ x: frame.pos[i].x, y: frame.pos[i].y, z: frame.pos[i].z });
        if (tr.length > this.trailLength) tr.shift();
      }
    }
  }

  clearTrails() {
    this.trails = this.trails.map(() => []);
  }

  render() {
    const ctx = this.ctx;
    if (this.canvas.width === 0) return;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // 夜空
    const sky = ctx.createLinearGradient(0, 0, 0, this.cssHeight);
    sky.addColorStop(0, '#05070f');
    sky.addColorStop(1, '#0d1524');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    const basis = this._viewBasis();
    if (this.options.showGrid) this._drawGround(ctx, basis);
    if (this.options.showGeofence) this._drawGeofence(ctx, basis);

    const frame = this._frame;
    if (frame) {
      if (this.options.showTrails) this._drawTrails(ctx, basis);
      this._drawDrones(ctx, basis, frame);
    }

    ctx.restore();
  }

  _drawGround(ctx, basis) {
    const half = 120;
    const step = 20;
    ctx.strokeStyle = 'rgba(120,160,220,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let g = -half; g <= half; g += step) {
      this._polyline(ctx, basis, [
        { x: g, y: -half, z: 0 },
        { x: g, y: half, z: 0 },
      ]);
      this._polyline(ctx, basis, [
        { x: -half, y: g, z: 0 },
        { x: half, y: g, z: 0 },
      ]);
    }
    ctx.stroke();

    // 原点の十字と方位
    ctx.strokeStyle = 'rgba(140,190,255,0.4)';
    ctx.beginPath();
    this._polyline(ctx, basis, [{ x: -half, y: 0, z: 0 }, { x: half, y: 0, z: 0 }]);
    this._polyline(ctx, basis, [{ x: 0, y: -half, z: 0 }, { x: 0, y: half, z: 0 }]);
    ctx.stroke();

    ctx.fillStyle = 'rgba(150,200,255,0.65)';
    ctx.font = '11px system-ui, sans-serif';
    const labels = [
      { p: { x: half, y: 0, z: 0 }, t: '東 +x' },
      { p: { x: 0, y: half, z: 0 }, t: '北 +y' },
      { p: { x: 0, y: -half, z: 0 }, t: '観客席' },
    ];
    for (const l of labels) {
      const s = this._project(l.p, basis);
      if (s) ctx.fillText(l.t, s.sx + 4, s.sy - 4);
    }
  }

  _drawGeofence(ctx, basis) {
    const r = this.options.geofenceRadius;
    const zTop = this.options.maxAltitude;
    ctx.strokeStyle = 'rgba(255,120,120,0.28)';
    ctx.setLineDash([5, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const z of [0, zTop]) {
      const pts = [];
      for (let a = 0; a <= 64; a++) {
        const th = (a / 64) * Math.PI * 2;
        pts.push({ x: Math.cos(th) * r, y: Math.sin(th) * r, z });
      }
      this._polyline(ctx, basis, pts);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** 近クリップを跨ぐ線分は捨てる簡易版のポリライン。 */
  _polyline(ctx, basis, pts) {
    let prev = null;
    for (const p of pts) {
      const s = this._project(p, basis);
      if (s && prev) {
        ctx.moveTo(prev.sx, prev.sy);
        ctx.lineTo(s.sx, s.sy);
      }
      prev = s;
    }
  }

  _drawTrails(ctx, basis) {
    ctx.lineWidth = 1;
    for (let i = 0; i < this.trails.length; i++) {
      const tr = this.trails[i];
      if (tr.length < 2) continue;
      const c = this._frame.col[i];
      for (let k = 1; k < tr.length; k++) {
        const a = this._project(tr[k - 1], basis);
        const b = this._project(tr[k], basis);
        if (!a || !b) continue;
        const alpha = (k / tr.length) * 0.32;
        ctx.strokeStyle = `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
    }
  }

  _drawDrones(ctx, basis, frame) {
    const items = [];
    for (let i = 0; i < frame.pos.length; i++) {
      const s = this._project(frame.pos[i], basis);
      if (s) items.push({ i, s });
    }
    items.sort((a, b) => b.s.depth - a.s.depth); // 奥から描く

    ctx.globalCompositeOperation = 'lighter';
    for (const { i, s } of items) {
      const c = frame.col[i];
      const rad = Math.max(1.2, this.options.droneSize * s.scale);
      const R = c.r | 0, G = c.g | 0, B = c.b | 0;
      // ハロー（隊列の形が潰れないよう控えめに）
      ctx.fillStyle = `rgba(${R},${G},${B},0.16)`;
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, rad * 2.8, 0, Math.PI * 2);
      ctx.fill();
      // 本体
      ctx.fillStyle = `rgba(${R},${G},${B},0.95)`;
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    if (this._highlight.size) {
      ctx.strokeStyle = 'rgba(255,80,80,0.95)';
      ctx.lineWidth = 1.5;
      for (const { i, s } of items) {
        if (!this._highlight.has(i)) continue;
        const rad = Math.max(1.2, this.options.droneSize * s.scale);
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, rad * 5 + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function len(v) {
  return Math.hypot(v.x, v.y, v.z);
}
function norm(v) {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
