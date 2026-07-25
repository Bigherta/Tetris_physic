// ============================================================
//  game.js — 游戏主控
//  状态机: ready -> playing -> (paused) -> over
//  接触触发模型 (AGENT.md §1): kinematic 阶段方块逐格自动下落 (经典俄罗斯方块
//    控制: ←→↑ / ↓软降 / 空格硬降); 接触平台或已放置方块时就地转为动态刚体,
//    由物理引擎接管, 玩家失去控制权.
//  计分 (AGENT.md §6): S_total = α·T + Σβ·h_i + γ·H²
// ============================================================

const DAS_DELAY = 160;     // 长按首次延迟 (ms)
const DAS_REPEAT = 45;     // 长按重复间隔 (ms)

class Game {
  constructor(canvas, nextCanvas) {
    this.canvas = canvas;
    this.physics = new PhysicsWorld();
    this.renderer = new Renderer(canvas, nextCanvas);
    this.nextCanvas = nextCanvas;

    this.state = 'ready';
    this.lives = MAX_LIVES;
    this.startTime = 0;
    this.elapsedMs = 0;
    this.nextShape = null;
    this.bag = new PieceBag();    // 7-bag 随机器 (标准俄罗斯方块生成)

    this.placeScore = 0;       // S_place 当前值
    this.peakHeight = 0;       // H (历史最高稳定高度)
    this.placedCount = 0;      // N
    this.droppedCount = 0;

    this.keys = { left: false, right: false, down: false };
    this.dasTimer = 0;
    this.dasPhase = 'delay';
    this.dropTimer = 0;          // kinematic 自动下落累计时间

    this.pendingSpawn = false;  // 接触转物理后, 等待生成区清空再生成下一块
    this.spawnWait = 0;

    this.onGameOver = null;    // 回调 (main 设置, 用于显示结算)
    this.onUpdate = null;      // 回调 (每帧更新 HUD)

    this.reset(true);
  }

  // ---- 重置 (silent: 不触发回调) ------------------------------
  reset(silent = false) {
    this.physics.clear();
    this.state = 'ready';
    this.lives = MAX_LIVES;
    this.startTime = 0;
    this.elapsedMs = 0;
    this.bag.reset();
    this.nextShape = this.bag.next();
    this.placeScore = 0;
    this.peakHeight = 0;
    this.placedCount = 0;
    this.droppedCount = 0;
    this.dasTimer = 0;
    this.dasPhase = 'delay';
    this.dropTimer = 0;
    this.pendingSpawn = false;
    this.spawnWait = 0;
    this._spawn(true);
    this.renderer.drawNext(this.nextShape);
    if (!silent) this._notify();
  }

  start() {
    if (this.state !== 'ready') return;
    this.state = 'playing';
    this.startTime = performance.now() - this.elapsedMs;
    this._notify();
  }

  pause() {
    if (this.state === 'playing') { this.state = 'paused'; this._notify(); }
    else if (this.state === 'paused') {
      this.state = 'playing';
      this.startTime = performance.now() - this.elapsedMs;
      this._notify();
    }
  }

  // ---- 生成新活动方块 (kinematic, isStatic) --------------------
  _spawn(initial = false) {
    const body = this.physics.createPiece(this.nextShape, SPAWN_X, SPAWN_Y, 0, true);
    this.physics.setActive(body);
    this.nextShape = this.bag.next();
    // 顶部锁死检测: 生成位置已与堆叠重叠 -> 游戏结束
    if (this.physics.collidesAt(body, body.position, body.angle)) {
      this._gameOver('LOCKOUT');
    }
  }

  // ---- 玩家/AI 动作 (立即生效) --------------------------------
  // 5 个动作: 左移 / 右移 / 旋转 / 软降(↓) / 硬降(空格)
  applyAction(action) {
    if (this.state !== 'playing') return;
    const p = this.physics;
    switch (action) {
      case ACTION.MOVE_LEFT:   this._moveHorizontal(-1, Settings.tapDist); break;
      case ACTION.MOVE_RIGHT:  this._moveHorizontal(1, Settings.tapDist); break;
      case ACTION.ROTATE_CW:   p.tryRotate(); break;
      case ACTION.SOFT_DROP:   this._descend(); break;    // 下一格; 接触则转物理
      case ACTION.HARD_DROP:   this._hardDrop(); break;   // 瞬间下落到接触, 转物理
      default: break;   // NOOP / 未知: 什么都不做
    }
  }

  _moveHorizontal(dir, dist) {
    const p = this.physics;
    const b = p.active;
    if (!b) return;
    const nx = b.position.x + dir * dist;
    // 允许悬于平台外, 但活动方块质心保留在画布内
    const margin = CELL * 0.5;
    if (nx < margin || nx > CANVAS_W - margin) return;   // 画布边界 -> 仅停下
    // 撞到别的方块/平台 -> 立即释放, 以当前横移速度撞向相邻方块.
    // 回退一小段间隙后释放, 使物理引擎从"接近接触"状态开始解算碰撞冲量,
    // 而非从已重叠状态开始 (后者易穿透).
    if (p.wouldHitBlock(dir * dist, 0)) {
      const backoff = 0.5;
      p.tryMove(-dir * backoff, 0);
      // 轻点视为瞬时: 用连续横移速度作为冲击速度 (换算为 Matter 的 px/步 单位)
      this._lockActive(dir * Settings.moveVelPerStep(), 0);
      return;
    }
    p.tryMove(dir * dist, 0);
  }

  // ---- 接触触发: 把当前 kinematic 方块就地转为动态刚体 ----------
  // 在最后一个不重叠位置 (canDescend() 为 false) 调用. 不立即生成下一块:
  // 待已转物理的方块离开顶部生成区后再生成, 避免与新生成方块重叠卡死.
  // vx/vy: 可选初始线速度 (横移撞向相邻方块时传入).
  _lockActive(vx = 0, vy = 0) {
    const now = performance.now();
    const body = this.physics.releaseActive(now, vx, vy);
    if (body) this.placedCount++;
    this.pendingSpawn = true;
    this.spawnWait = 0;
    this.dropTimer = 0;
  }

  // ---- 精确锁定: 先粗扫到 cell 网格, 再精扫到接触前最后位置, 再转物理
  // 消除最大 1 格的空隙, 使落地几乎无冲量 -> 不与下方方块睡眠冻结成重叠.
  _lockAtContact() {
    const p = this.physics;
    const y = p.contactY();
    if (y != null) p.snapActiveToY(y);
    this._lockActive();
  }

  // ---- 下移 1 格 (自动下落 / 软降) ----------------------------
  // 能下移则下移; 若下移后即接触, 精确锁定转物理 (无锁定延迟, 符合 §1 接触触发).
  _descend() {
    const p = this.physics;
    if (!p.active) return;
    if (!p.canDescend()) { this._lockAtContact(); return; }   // 已接触 -> 精确锁定
    p.tryMove(0, CELL);
    if (!p.canDescend()) this._lockAtContact();               // 刚到位即接触 -> 精确锁定
  }

  // ---- 硬降: 瞬间下落到接触, 精确锁定转物理 --------------------
  _hardDrop() {
    const p = this.physics;
    if (!p.active) return;
    let guard = 0;
    while (p.canDescend() && guard++ < ROWS + 4) p.tryMove(0, CELL);
    this._lockAtContact();
  }

  // ---- (内部) 生成下一块 --------------------------------------
  _doSpawn() {
    this._spawn();
    this.renderer.drawNext(this.nextShape);
    this.pendingSpawn = false;
    this.spawnWait = 0;
    this.dropTimer = 0;
  }

  // ---- 单步模拟 (人类每帧 / env 每步都调用) -------------------
  update(dtMs) {
    if (this.state !== 'playing') {
      return { events: [] };
    }
    if (dtMs > 33) dtMs = 33;          // 钳制大步长, 保持稳定
    this.elapsedMs += dtMs;
    const p = this.physics;

    // 物理: 推进已转物理的动态刚体 (kinematic 活动方块是静态的, 不受重力)
    p.step(dtMs);

    // kinematic 阶段: 经典俄罗斯方块式自动下落. 活动方块按间隔逐格下移;
    // 接触平台或已放置方块时由 _descend 内部就地转物理. 无活动方块时
    // 走生成区清空检查, 生成下一块.
    if (p.active) {
      this.dropTimer += dtMs;
      const interval = this.keys.down ? SOFT_DROP_INTERVAL_MS : DROP_INTERVAL_MS;
      if (this.dropTimer >= interval) {
        this.dropTimer -= interval;
        this._descend();
      }
    } else if (this.pendingSpawn) {
      this.spawnWait++;
      if (p.isSpawnClear() || this.spawnWait > SPAWN_FORCE_FRAMES) {
        this._doSpawn();
      }
    }

    // 长按 ←/→ 自动重复 (kinematic 方块仍可被移动)
    this._handleDAS(dtMs);

    // 稳定 -> 放置奖励
    this._updateStability();
    // 掉落检测
    this._updateDrops();
    // 峰值高度
    const h = p.peakStableHeight();
    if (h > this.peakHeight) this.peakHeight = h;

    if (this.lives <= 0) this._gameOver('NOLIVES');

    this._notify();
    return { events: [] };
  }

  // ---- 按住 ←/→ 连续横移 (恒定速度平滑移动, 非整格跳进) ----------
  // 按下瞬间的小幅响应由 main.js 的 applyAction(MOVE_LEFT/RIGHT) 处理;
  // 这里负责按住期间的连续推进, 以 Settings.moveSpeed px/s 逐帧位移.
  // 撞到画布边界 -> 停下; 撞到别的方块/平台 -> 立即释放, 并以当前横移速度
  // 作为初始水平速度赋予刚体, 使其以该速度撞向相邻方块.
  _handleDAS(dt) {
    const left = this.keys.left, right = this.keys.right;
    if (left === right) return;          // 都没按或都按 -> 不动
    const dir = left ? -1 : 1;
    const p = this.physics;
    const b = p.active;
    if (!b) return;
    const dist = Settings.moveSpeed * (dt / 1000);   // 本帧位移 (px)
    if (dist <= 0) return;
    // 拆成小步以稳定碰撞检测 (避免一帧穿透)
    const step = Math.min(dist, CELL * 0.4);
    let remaining = dist;
    const margin = CELL * 0.5;
    while (remaining > 1e-4) {
      const d = Math.min(remaining, step);
      const nx = b.position.x + dir * d;
      if (nx < margin || nx > CANVAS_W - margin) break;   // 画布边界 -> 停下
      if (p.wouldHitBlock(dir * d, 0)) {                   // 撞别的方块 -> 释放转物理
        p.tryMove(-dir * 0.5, 0);                           // 回退一小段间隙
        this._lockActive(dir * Settings.moveVelPerStep()); // 以当前横移速度撞击
        return;
      }
      p.tryMove(dir * d, 0);
      remaining -= d;
    }
  }

  // ---- 稳定性 & 放置奖励 --------------------------------------
  _updateStability() {
    const now = performance.now();
    for (const b of this.physics.placed) {
      if (b.rewarded) continue;
      const stable = this.physics._isStable(b);
      if (stable) {
        b.stableFrames++;
        if (b.stableFrames >= STABLE_FRAMES) {
          const h = this.physics.comHeight(b);
          const contrib = BETA * h + DELTA;   // 高度奖励 + 每块固定奖励(块数权重)
          b.rewarded = true;
          b.contribution = contrib;
          b.heightAtReward = h;
          this.placeScore += contrib;
        }
      } else {
        b.stableFrames = 0;
      }
    }
  }

  // ---- 掉落检测 & 生命/惩罚 ------------------------------------
  _updateDrops() {
    const dropped = this.physics.getDropped();
    for (const b of dropped) {
      this.droppedCount++;
      this.lives--;
      if (b.rewarded) {
        this.placeScore -= b.contribution;
      }
    }
  }

  // ---- 游戏结束 ------------------------------------------------
  _gameOver(reason) {
    if (this.state === 'over') return;
    this.state = 'over';
    this._notify();
    if (this.onGameOver) this.onGameOver(this.scoreInfo(), reason);
  }

  _notify() {
    if (this.onUpdate) this.onUpdate(this.scoreInfo());
  }

  // ---- 得分信息 (§6) ------------------------------------------
  get timeSeconds() { return this.elapsedMs / 1000; }
  get sTime() { return ALPHA * this.timeSeconds; }
  get sPlace() { return this.placeScore; }
  get sHeight() { return GAMMA * this.peakHeight * this.peakHeight; }
  get totalScore() { return this.sTime + this.sPlace + this.sHeight; }

  scoreInfo() {
    return {
      state: this.state,
      lives: this.lives,
      time: this.timeSeconds,
      sTime: this.sTime,
      sPlace: this.sPlace,
      sHeight: this.sHeight,
      total: this.totalScore,
      peak: this.peakHeight,
      placed: this.placedCount,
      dropped: this.droppedCount,
    };
  }

  // ---- 渲染 ----------------------------------------------------
  render() {
    this.renderer.draw(this.physics, this);
  }
}
