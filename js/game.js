// ============================================================
//  game.js — 游戏主控
//  状态机: ready -> playing -> (paused) -> over
//  新规则: 方块生成后悬挂于上方、不自动下落; 玩家仅 ←→↑ 调整,
//          按空格(释放)后方块转为动态刚体自由下落, 玩家失去控制权.
//  计分 (AGENT.md §3): S_total = α·T + Σβ·h_i + γ·H²
//  RL 奖励 (§4.3) 通过 pendingReward 累积, 由 env.flush() 取走
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

    this.placeScore = 0;       // S_place 当前值
    this.peakHeight = 0;       // H (历史最高稳定高度)
    this.placedCount = 0;      // N
    this.droppedCount = 0;

    this.keys = { left: false, right: false };
    this.dasTimer = 0;
    this.dasPhase = 'delay';

    this.pendingSpawn = false;  // 释放后等待生成区清空再生成下一块
    this.spawnWait = 0;

    this.pendingReward = 0;    // 累积 RL 奖励 (env 取走)
    this.pendingEvents = [];   // 累积事件
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
    this.nextShape = randomShapeKey();
    this.placeScore = 0;
    this.peakHeight = 0;
    this.placedCount = 0;
    this.droppedCount = 0;
    this.dasTimer = 0;
    this.dasPhase = 'delay';
    this.pendingSpawn = false;
    this.spawnWait = 0;
    this.pendingReward = 0;
    this.pendingEvents = [];
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

  // ---- 生成新活动方块 -----------------------------------------
  _spawn(initial = false) {
    const body = this.physics.createPiece(this.nextShape, SPAWN_X, SPAWN_Y, 0, true);
    this.physics.setActive(body);
    this.nextShape = randomShapeKey();
    // 顶部锁死检测: 生成位置已与堆叠重叠 -> 游戏结束
    if (this.physics.collidesAt(body, body.position, body.angle)) {
      this._gameOver('LOCKOUT');
    }
  }

  // ---- 玩家/AI 动作 (立即生效) --------------------------------
  // 新规则仅 4 个有效动作: 左移 / 右移 / 旋转 / 释放(空格)
  applyAction(action) {
    if (this.state !== 'playing') return;
    const p = this.physics;
    switch (action) {
      case ACTION.MOVE_LEFT:   this._moveHorizontal(-1); break;
      case ACTION.MOVE_RIGHT:  this._moveHorizontal(1); break;
      case ACTION.ROTATE_CW:   p.tryRotate(); break;
      case ACTION.HARD_DROP:   this._releaseAndSpawn(); break;  // 释放 -> 物理接管
      default: break;   // NOOP / 未知: 什么都不做 (悬挂方块静止等待)
    }
  }

  _moveHorizontal(dir) {
    const p = this.physics;
    const b = p.active;
    if (!b) return;
    const nx = b.position.x + dir * CELL;
    // 允许悬挂于平台外, 但活动方块质心保留在画布内
    const margin = CELL * 0.5;
    if (nx < margin || nx > CANVAS_W - margin) return;
    p.tryMove(dir * CELL, 0);
  }

  // ---- 释放当前方块 ------------------------------------------
  // 就地把活动方块转为动态刚体(开始自由下落). 不立即生成下一块:
  // 待已释放方块离开顶部生成区后再生成, 避免与新生成方块重叠卡死.
  _releaseAndSpawn() {
    const now = performance.now();
    const body = this.physics.releaseActive(now);
    if (body) this.placedCount++;
    this.pendingSpawn = true;
    this.spawnWait = 0;
  }

  // ---- (内部) 生成下一块 --------------------------------------
  _doSpawn() {
    this._spawn();
    this.renderer.drawNext(this.nextShape);
    this.pendingSpawn = false;
    this.spawnWait = 0;
  }

  // ---- 单步模拟 (人类每帧 / env 每步都调用) -------------------
  update(dtMs) {
    if (this.state !== 'playing') {
      return { events: [] };
    }
    if (dtMs > 33) dtMs = 33;          // 钳制大步长, 保持稳定
    this.elapsedMs += dtMs;
    const p = this.physics;

    // 物理: 推进已释放的动态刚体 (悬挂中的活动方块是静态的, 不受重力)
    p.step(dtMs);

    // 释放后: 等待生成区清空再生成下一块 (避免重叠卡死)
    if (this.pendingSpawn && !p.active) {
      this.spawnWait++;
      if (p.isSpawnClear() || this.spawnWait > SPAWN_FORCE_FRAMES) {
        this._doSpawn();
      }
    }

    // 长按 ←/→ 自动重复 (悬挂方块仍可被移动)
    this._handleDAS(dtMs);

    // 稳定 -> 放置奖励
    this._updateStability();
    // 掉落检测
    this._updateDrops();
    // 峰值高度
    const h = p.peakStableHeight();
    if (h > this.peakHeight) this.peakHeight = h;

    // 生存步奖励
    this._addReward(R_STEP, { type: 'step' });

    if (this.lives <= 0) this._gameOver('NOLIVES');

    this._notify();
    return { events: [] };
  }

  // ---- 长按重复 ------------------------------------------------
  _handleDAS(dt) {
    const left = this.keys.left, right = this.keys.right;
    if (left === right) { this.dasPhase = 'delay'; this.dasTimer = 0; return; }
    const dir = left ? -1 : 1;
    this.dasTimer += dt;
    if (this.dasPhase === 'delay') {
      if (this.dasTimer >= DAS_DELAY) {
        this.dasPhase = 'repeat'; this.dasTimer = 0;
        this._moveHorizontal(dir);
      }
    } else {
      if (this.dasTimer >= DAS_REPEAT) {
        this.dasTimer = 0;
        this._moveHorizontal(dir);
      }
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
          const contrib = BETA * h;
          b.rewarded = true;
          b.contribution = contrib;
          b.heightAtReward = h;
          this.placeScore += contrib;
          this._addReward(R_PLACE_K * h, { type: 'place', height: h });
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
      this._addReward(R_DROP, { type: 'drop' });
    }
  }

  // ---- 游戏结束 ------------------------------------------------
  _gameOver(reason) {
    if (this.state === 'over') return;
    this.state = 'over';
    this._addReward(R_GAMEOVER, { type: 'gameover', reason });
    this._notify();
    if (this.onGameOver) this.onGameOver(this.scoreInfo(), reason);
  }

  // ---- 奖励/事件累积 ------------------------------------------
  _addReward(r, ev) {
    this.pendingReward += r;
    if (ev) this.pendingEvents.push(ev);
  }
  flushReward() {
    const r = this.pendingReward;
    this.pendingReward = 0;
    const ev = this.pendingEvents;
    this.pendingEvents = [];
    return { reward: r, events: ev };
  }

  _notify() {
    if (this.onUpdate) this.onUpdate(this.scoreInfo());
  }

  // ---- 得分信息 (§3) ------------------------------------------
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
      next: this.nextShape,
      active: this.physics.activeShape,
    };
  }

  // ---- 渲染 ----------------------------------------------------
  render() {
    this.renderer.draw(this.physics, this);
  }
}
