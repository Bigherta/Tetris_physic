// ============================================================
//  physics.js — 基于 Matter.js 的 2D 刚体物理世界
//  负责: 引擎/平台/复合刚体创建、碰撞预测、放置、掉落与休眠检测
//  对应 AGENT.md §2.2: 接触后转为刚体, 受重力/摩擦/力矩/质心支配
// ============================================================

const { Engine, World, Bodies, Body, Composite, Query, Events, Vector, Sleeping } = Matter;

class PhysicsWorld {
  constructor() {
    this.engine = Engine.create();
    this.engine.gravity.y = GRAVITY_Y;
    this.engine.gravity.scale = GRAVITY_SCALE;
    this.engine.enableSleeping = SLEEPING_ENABLED;
    this.world = this.engine.world;

    this.platform = null;
    this.placed = [];        // 已放置的动态刚体
    this.active = null;       // 当前下落中的(静态, 玩家控制)刚体
    this.activeShape = null;

    this._buildPlatform();
  }

  // ---- 平台: 居中、静态、高摩擦 ----------------------------------
  _buildPlatform() {
    const w = PLATFORM_WIDTH * CELL;
    const h = PLATFORM_HEIGHT;
    const cx = (PLATFORM_LEFT_COL + PLATFORM_WIDTH / 2) * CELL;
    const cy = PLATFORM_TOP_Y + h / 2;
    this.platform = Bodies.rectangle(cx, cy, w, h, {
      isStatic: true,
      friction: PLATFORM_FRICTION,
      frictionStatic: PLATFORM_FRICTION,
      restitution: 0,
      label: 'platform',
    });
    World.add(this.world, this.platform);
  }

  // ---- 创建一个复合方块刚体 --------------------------------------
  // shapeKey: 形状; (px,py): 期望质心位置; angle: 初始角度
  createPiece(shapeKey, px, py, angle = 0, isStatic = true) {
    const cells = SHAPES[shapeKey];
    const parts = cells.map(([cx, cy]) =>
      Bodies.rectangle(px + cx * CELL, py + cy * CELL, CELL, CELL, {
        density: BLOCK_DENSITY,
        friction: BLOCK_FRICTION,
        frictionStatic: BLOCK_FRICTION_STATIC,
        restitution: BLOCK_RESTITUTION,
        chamfer: { radius: 2 },
      })
    );
    const body = Body.create({
      parts,
      isStatic,
      friction: BLOCK_FRICTION,
      frictionStatic: BLOCK_FRICTION_STATIC,
      restitution: BLOCK_RESTITUTION,
      label: 'piece:' + shapeKey,
    });
    // 使质心精确位于 (px,py), 这样旋转/移动都以质心为参考
    Body.setPosition(body, { x: px, y: py });
    Body.setAngle(body, angle);
    body.pieceShape = shapeKey;
    body.pieceColor = COLORS[shapeKey];
    body.placedAt = null;       // 放置时间戳
    body.stableFrames = 0;       // 静止累计帧
    body.rewarded = false;       // 是否已发放放置奖励
    body.contribution = 0;       // 该方块对 S_place 的贡献 (β·h)
    body.heightAtReward = 0;
    return body;
  }

  // ---- 把一个刚体设为当前活动方块 --------------------------------
  setActive(body) {
    this.active = body;
    this.activeShape = body.pieceShape;
    World.add(this.world, body);
  }

  // ---- 在假设位置/角度检测是否与平台或已放置方块重叠 ------------
  // 返回 true 表示发生碰撞 (不可移动到该状态)
  collidesAt(body, pos, angle) {
    const savedPos = { x: body.position.x, y: body.position.y };
    const savedAngle = body.angle;
    Body.setPosition(body, pos);
    Body.setAngle(body, angle);
    const targets = [this.platform, ...this.placed];
    let hit = false;
    const res = Query.collides(body, targets);
    if (res && res.length > 0) hit = true;
    // 恢复
    Body.setPosition(body, savedPos);
    Body.setAngle(body, savedAngle);
    return hit;
  }

  // ---- 活动方块尝试平移; 成功返回 true --------------------------
  tryMove(dx, dy) {
    const b = this.active;
    if (!b) return false;
    const np = { x: b.position.x + dx, y: b.position.y + dy };
    if (this.collidesAt(b, np, b.angle)) return false;
    Body.setPosition(b, np);
    return true;
  }

  // ---- 活动方块尝试顺时针旋转 90° (带简易 wall-kick) ------------
  tryRotate() {
    const b = this.active;
    if (!b) return false;
    const newAngle = b.angle + Math.PI / 2;
    const kicks = [
      [0, 0], [-CELL, 0], [CELL, 0], [0, -CELL],
      [-2 * CELL, 0], [2 * CELL, 0], [0, -2 * CELL],
      [-CELL, -CELL], [CELL, -CELL],
    ];
    for (const [kx, ky] of kicks) {
      const np = { x: b.position.x + kx, y: b.position.y + ky };
      if (!this.collidesAt(b, np, newAngle)) {
        Body.setPosition(b, np);
        Body.setAngle(b, newAngle);
        return true;
      }
    }
    return false;
  }

  // ---- 释放当前活动方块: 在当前位置转为动态刚体 ----------------
  // 新规则: 不再预先下扫贴合, 而是就地解锁为动态刚体,
  //         由重力接管其自由下落, 玩家从此失去对该方块的控制权.
  // 返回该 body 供游戏层处理稳定/掉落/计分.
  releaseActive(now) {
    const b = this.active;
    if (!b) return null;
    Body.setStatic(b, false);
    // 关键: 悬挂期间 enableSleeping 会把静态刚体置为休眠, setStatic 不会自动唤醒;
    // 必须显式唤醒, 否则 Matter 不会对其施加重力 -> 方块卡在顶部不下落.
    Sleeping.set(b, false);
    b.isSleeping = false;
    b.sleepCounter = 0;
    // 重新施加材质 (setStatic 可能重置部分属性)
    b.friction = BLOCK_FRICTION;
    b.frictionStatic = BLOCK_FRICTION_STATIC;
    b.restitution = BLOCK_RESTITUTION;
    for (const p of b.parts) {
      if (p === b) continue;
      p.friction = BLOCK_FRICTION;
      p.frictionStatic = BLOCK_FRICTION_STATIC;
      p.restitution = BLOCK_RESTITUTION;
    }
    b.placedAt = now;
    b.stableFrames = 0;
    b.rewarded = false;
    this.placed.push(b);
    this.active = null;
    this.activeShape = null;
    return b;
  }

  // ---- 生成区是否已清空 (供游戏层判断能否生成下一块) ----------
  // 检查是否有已放置(含正在下落)的刚体仍占据顶部生成区.
  isSpawnClear() {
    const xMin = SPAWN_X - SPAWN_CLEAR_X;
    const xMax = SPAWN_X + SPAWN_CLEAR_X;
    const yMax = SPAWN_Y + SPAWN_CLEAR_Y;
    for (const b of this.placed) {
      if (b.bounds.min.y < yMax && b.bounds.max.x > xMin && b.bounds.min.x < xMax) {
        return false;
      }
    }
    return true;
  }

  // ---- 物理推进一步 --------------------------------------------
  step(dt) {
    Engine.update(this.engine, dt);
  }

  // ---- 检测掉落 (Y 越过 DROP_Y), 返回掉落的刚体数组 -------------
  getDropped() {
    const dropped = [];
    for (let i = this.placed.length - 1; i >= 0; i--) {
      const b = this.placed[i];
      if (b.bounds.max.y > DROP_Y) {
        dropped.push(b);
        World.remove(this.world, b);
        this.placed.splice(i, 1);
      }
    }
    return dropped;
  }

  // ---- 当前稳定刚体, 用于高度测量 -----------------------------
  // 注意: 不能仅凭瞬时低速判定, 否则刚释放(重力尚未加速)的方块会被误判
  //       为稳定, 把高度虚报到生成位置. 这里要求 休眠 或 持续低速达阈值帧.
  stableBodies() {
    return this.placed.filter(b => b.isSleeping || b.stableFrames >= STABLE_FRAMES);
  }

  // ---- 瞬时低速判定 (供放置奖励的稳定计数与危险高亮使用) --------
  _isStable(b) {
    if (b.isSleeping) return true;
    const v = Math.hypot(b.velocity.x, b.velocity.y);
    const w = Math.abs(b.angularVelocity);
    return v < STABLE_SPEED && w < STABLE_OMEGA;
  }

  // ---- 平台上方最高稳定点 (单位高度 H) --------------------------
  peakStableHeight() {
    let topY = PLATFORM_TOP_Y;
    for (const b of this.stableBodies()) {
      if (b.bounds.min.y < topY) topY = b.bounds.min.y;
    }
    return Math.max(0, (PLATFORM_TOP_Y - topY) / CELL);
  }

  // ---- 方块质心高度 (单位), 用于 h_i ----------------------------
  comHeight(body) {
    return Math.max(0, (PLATFORM_TOP_Y - body.position.y) / CELL);
  }

  // ---- 清空世界 (重开) -----------------------------------------
  clear() {
    World.clear(this.world, false);
    this.placed = [];
    this.active = null;
    this.activeShape = null;
    this._buildPlatform();
  }

  // ---- 平台上方高度图 (10 列), 用于观察空间 (Option A) ----------
  heightmap() {
    const cols = PLATFORM_WIDTH;
    const map = new Array(cols).fill(0);
    const x0 = PLATFORM_LEFT_COL * CELL;
    const stable = this.stableBodies();
    for (let c = 0; c < cols; c++) {
      const cx = x0 + (c + 0.5) * CELL;
      let topY = PLATFORM_TOP_Y;
      for (const b of stable) {
        // 该列内方块的最高点
        if (cx >= b.bounds.min.x && cx <= b.bounds.max.x) {
          if (b.bounds.min.y < topY) topY = b.bounds.min.y;
        }
      }
      map[c] = (PLATFORM_TOP_Y - topY) / CELL;
    }
    return map;
  }
}
