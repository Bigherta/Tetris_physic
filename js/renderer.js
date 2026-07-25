// ============================================================
//  renderer.js — Canvas 渲染层
//  绘制: 背景/深渊/网格/平台/已放置刚体/活动方块/落点预览/下一块
//  HUD (生命/得分) 由 HTML 面板负责, 这里只画游戏世界
//  (不在此处顶层解构 Matter.Body, 避免与 physics.js 的顶层 const 冲突)
// ============================================================

class Renderer {
  constructor(canvas, nextCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nextCanvas = nextCanvas;
    this.nextCtx = nextCanvas ? nextCanvas.getContext('2d') : null;
  }

  // ---- 整个世界一帧 -------------------------------------------
  draw(physics, game) {
    const ctx = this.ctx;
    this._drawBackground();
    this._drawAbyss();
    this._drawGrid();
    this._drawPlatform();
    if (physics.active && game.state === 'playing') {
      this._drawGhost(physics);
      this._drawBlockBody(physics.active, 1);
    }
    for (const b of physics.placed) this._drawBlockBody(b, 1);
  }

  // ---- 背景 ---------------------------------------------------
  _drawBackground() {
    const ctx = this.ctx;
    ctx.fillStyle = UI.bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // ---- 两侧深渊红雾 -------------------------------------------
  _drawAbyss() {
    const ctx = this.ctx;
    const x0 = PLATFORM_LEFT_COL * CELL;
    const x1 = (PLATFORM_LEFT_COL + PLATFORM_WIDTH) * CELL;
    // 平台两侧
    const g1 = ctx.createLinearGradient(0, 0, x0, 0);
    g1.addColorStop(0, 'rgba(239,68,68,0.10)');
    g1.addColorStop(1, 'rgba(239,68,68,0)');
    ctx.fillStyle = g1; ctx.fillRect(0, 0, x0, CANVAS_H);
    const g2 = ctx.createLinearGradient(x1, 0, CANVAS_W, 0);
    g2.addColorStop(0, 'rgba(239,68,68,0)');
    g2.addColorStop(1, 'rgba(239,68,68,0.10)');
    ctx.fillStyle = g2; ctx.fillRect(x1, 0, CANVAS_W - x1, CANVAS_H);
    // 平台下方深渊
    const g3 = ctx.createLinearGradient(0, PLATFORM_TOP_Y, 0, CANVAS_H);
    g3.addColorStop(0, 'rgba(239,68,68,0)');
    g3.addColorStop(1, 'rgba(239,68,68,0.18)');
    ctx.fillStyle = g3; ctx.fillRect(0, PLATFORM_TOP_Y, CANVAS_W, CANVAS_H - PLATFORM_TOP_Y);
  }

  // ---- 网格参考线 ---------------------------------------------
  _drawGrid() {
    const ctx = this.ctx;
    ctx.lineWidth = 1;
    ctx.strokeStyle = UI.grid;
    ctx.beginPath();
    for (let x = 0; x <= COLS; x++) {
      ctx.moveTo(x * CELL + 0.5, 0);
      ctx.lineTo(x * CELL + 0.5, CANVAS_H);
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.moveTo(0, y * CELL + 0.5);
      ctx.lineTo(CANVAS_W, y * CELL + 0.5);
    }
    ctx.stroke();
    // 平台区域强边框
    ctx.strokeStyle = UI.gridStrong;
    ctx.strokeRect(PLATFORM_LEFT_COL * CELL, 0, PLATFORM_WIDTH * CELL, PLATFORM_TOP_Y);
  }

  // ---- 平台 ---------------------------------------------------
  _drawPlatform() {
    const ctx = this.ctx;
    const x = PLATFORM_LEFT_COL * CELL;
    const y = PLATFORM_TOP_Y;
    const w = PLATFORM_WIDTH * CELL;
    const h = PLATFORM_HEIGHT;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#334155');
    g.addColorStop(1, '#0f172a');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = UI.platformEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    // 顶面高光
    ctx.fillStyle = 'rgba(148,163,184,0.6)';
    ctx.fillRect(x, y, w, 3);
    // 危险边界提示线 (平台两侧垂直边)
    ctx.strokeStyle = 'rgba(239,68,68,0.5)';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x, y + h);
    ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---- 落点预览 (ghost) ---------------------------------------
  _drawGhost(physics) {
    const b = physics.active;
    if (!b) return;
    // 向下扫描到碰撞前最后位置
    const pos = { x: b.position.x, y: b.position.y };
    const ang = b.angle;
    const big = CELL;
    let y = pos.y;
    while (y < DROP_Y && !physics.collidesAt(b, { x: pos.x, y: y + big }, ang)) y += big;
    if (y < DROP_Y) {
      const fine = LOCK_FINE_STEP;
      for (let i = 0; i < CELL / fine; i++) {
        if (y < DROP_Y && !physics.collidesAt(b, { x: pos.x, y: y + fine }, ang)) y += fine;
        else break;
      }
    }
    // 在 ghost 位置绘制描边方块
    const ctx = this.ctx;
    const saved = { x: b.position.x, y: b.position.y };
    Matter.Body.setPosition(b, { x: pos.x, y });
    ctx.save();
    ctx.globalAlpha = 0.28;
    for (const p of b.parts) {
      if (p === b) continue;
      this._strokeTile(p.position.x, p.position.y, ang, CELL, b.pieceColor.fill);
    }
    ctx.restore();
    Matter.Body.setPosition(b, saved);
  }

  // ---- 绘制一个复合方块刚体 -----------------------------------
  _drawBlockBody(body, alpha) {
    const ctx = this.ctx;
    const col = body.pieceColor;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (const p of body.parts) {
      if (p === body) continue;
      this._drawTile(p.position.x, p.position.y, body.angle, CELL, col);
    }
    ctx.restore();
  }

  // ---- 单格斜面贴片 -------------------------------------------
  _drawTile(cx, cy, angle, size, col) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    // 外框 (暗)
    this._roundRect(ctx, -size / 2, -size / 2, size, size, 3);
    ctx.fillStyle = col.dark; ctx.fill();
    // 内填充 (主色)
    const inset = 3;
    this._roundRect(ctx, -size / 2 + inset, -size / 2 + inset, size - inset * 2, size - inset * 2, 2);
    const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    g.addColorStop(0, col.light);
    g.addColorStop(1, col.fill);
    ctx.fillStyle = g; ctx.fill();
    // 顶/左 高光
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-size / 2 + inset + 1, -size / 2 + inset + 1);
    ctx.lineTo(size / 2 - inset - 1, -size / 2 + inset + 1);
    ctx.moveTo(-size / 2 + inset + 1, -size / 2 + inset + 1);
    ctx.lineTo(-size / 2 + inset + 1, size / 2 - inset - 1);
    ctx.stroke();
    ctx.restore();
  }

  _strokeTile(cx, cy, angle, size, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    this._roundRect(ctx, -size / 2, -size / 2, size, size, 3);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- 下一块预览 ---------------------------------------------
  drawNext(shapeKey) {
    if (!this.nextCtx || !shapeKey) return;
    const ctx = this.nextCtx;
    const W = this.nextCanvas.width, H = this.nextCanvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = UI.bg;
    ctx.fillRect(0, 0, W, H);
    if (!shapeKey) return;
    const cells = SHAPES[shapeKey];
    const b = boundsOf(cells);
    const u = Math.min(W / (b.w + 1), H / (b.h + 1), 22);
    const ox = (W - b.w * u) / 2 - b.minX * u;
    const oy = (H - b.h * u) / 2 - b.minY * u;
    const col = COLORS[shapeKey];
    ctx.save();
    ctx.translate(ox, oy);
    for (const [cx, cy] of cells) {
      ctx.save();
      ctx.translate(cx * u, cy * u);
      this._roundRectScaled(u, col);
      ctx.restore();
    }
    ctx.restore();
  }

  _roundRectScaled(u, col) {
    const ctx = this.nextCtx;
    this._roundRect(ctx, -u / 2, -u / 2, u, u, 3);
    ctx.fillStyle = col.dark; ctx.fill();
    const inset = 2;
    this._roundRect(ctx, -u / 2 + inset, -u / 2 + inset, u - inset * 2, u - inset * 2, 2);
    const g = ctx.createLinearGradient(0, -u / 2, 0, u / 2);
    g.addColorStop(0, col.light); g.addColorStop(1, col.fill);
    ctx.fillStyle = g; ctx.fill();
  }
}
