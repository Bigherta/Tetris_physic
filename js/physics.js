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
    // 提高求解器迭代数: 默认 6/4/2 不足以稳定"高瘦"刚体 (如竖立的 I 块),
    // 会产生接触点交替穿透 -> 左右晃动 -> 最终误倒. 提到 12/8/3 让接触充分解算.
    this.engine.positionIterations = 12;
    this.engine.velocityIterations = 8;
    this.engine.constraintIterations = 3;
    this.world = this.engine.world;

    this.platform = null;
    this.placed = [];        // 已放置的动态刚体
    this.active = null;       // 当前下落中的(静态, 玩家控制)刚体
    this.activeShape = null;

    this._buildPlatform();

    // 落地真实化: 释放后的刚体在 RELEASE_NO_SLEEP_FRAMES 帧内禁止休眠.
    // 否则小间隙+冲击速度造成的微小穿透会被休眠冻结成可见重叠
    // (这正是当年精确贴面所要规避的 bug). 每次引擎更新后唤醒窗口内的刚体.
    Events.on(this.engine, 'afterUpdate', () => this._preventEarlySleep());
  }

  // ---- 唤醒仍在「禁止休眠窗口」内的刚体 ------------------------
  // noSleepFrames > 0 的刚体: 递减计数; 若被引擎自动休眠则强制唤醒.
  // 窗口期内让求解器先解算落地穿透, 期满后正常休眠 (不影响稳定/计分).
  _preventEarlySleep() {
    for (const b of this.placed) {
      if (b.noSleepFrames > 0) {
        b.noSleepFrames--;
        if (b.isSleeping) Sleeping.set(b, false);
      }
    }
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
  // shapeKey: 形状; (px,py): 部件生成参考点 (整数倍 CELL, 与半整数偏移配合使方块落于网格格心);
  //           angle: 初始角度; material: 'normal' | 'stone' — 决定密度等 (石块更重)
  createPiece(shapeKey, px, py, angle = 0, isStatic = true, material = 'normal') {
    const cells = SHAPES[shapeKey];
    const mat = MATERIALS[material] || MATERIALS.normal;
    const parts = cells.map(([cx, cy]) =>
      Bodies.rectangle(px + cx * CELL, py + cy * CELL, CELL, CELL, {
        density: mat.density,
        friction: mat.friction,
        frictionStatic: mat.frictionStatic,
        restitution: mat.restitution,
        // 不加 chamfer: 倒角会让单元格角点变圆, 竖立 I 块以此圆角为支点
        // 产生微抖动并被放大成倾倒. 平直面接触更稳定 (视觉圆角由 renderer 负责).
      })
    );
    const body = Body.create({
      parts,
      isStatic,
      friction: mat.friction,
      frictionStatic: mat.frictionStatic,
      restitution: mat.restitution,
      label: 'piece:' + shapeKey,
    });
    // Body.create 已据各部件自动算出质心 (body.position = 部件质心), 旋转/平移都以该质心
    // 为参考 (与真实刚体一致). 各部件在创建时已落于网格格心 (半整数偏移 + 整数倍 CELL),
    // 故方块整体与游戏网格对齐; 不再用 setPosition 覆盖质心, 以免把方块推离网格.
    Body.setAngle(body, angle);
    body.pieceShape = shapeKey;
    body.pieceMaterial = material;
    body.pieceColor = materialColor(material, shapeKey);
    // 记录材质物理参数, 供 releaseActive 在 setStatic(false) 后重新施加 (含密度 -> 质量)
    body.matProps = { density: mat.density, friction: mat.friction, frictionStatic: mat.frictionStatic, restitution: mat.restitution };
    body.placedAt = null;       // 放置时间戳
    body.stableFrames = 0;       // 静止累计帧
    body.rewarded = false;       // 是否已发放放置奖励
    body.contribution = 0;       // 该方块对 S_place 的贡献 (β·h)
    body.heightAtReward = 0;
    body.noSleepFrames = 0;     // 释放后禁止休眠的剩余帧数 (落地真实化)
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

  // ---- 活动方块能否再下移 1 格 (不实际移动) -------------------
  // 用于自动下落 / 软降: 返回 false 表示下一格即接触平台或已放置方块,
  // 调用方应在当前位置 (最后一个不重叠位置) 调用 releaseActive 就地转物理.
  canDescend() {
    const b = this.active;
    if (!b) return false;
    return !this.collidesAt(b, { x: b.position.x, y: b.position.y + CELL }, b.angle);
  }

  // ---- 下落到接触前的精确 Y (最后一个不重叠位置) ---------------
  // 先 CELL 粗扫, 再 LOCK_FINE_STEP 精扫. 锁定时把方块置于该 Y, 几乎无空隙,
  // 落地无冲量, 避免与下方方块因冲击穿透 + 休眠冻结而相互重叠.
  // 若一路扫到画布底仍无接触 (方块整体悬空于深渊), 返回接近 DROP_Y 的 Y,
  // 调用方锁定后即转为动态刚体坠入深渊, 由 getDropped 处理.
  contactY() {
    const b = this.active;
    if (!b) return null;
    const x = b.position.x, ang = b.angle;
    let y = b.position.y;
    while (y < DROP_Y && !this.collidesAt(b, { x, y: y + CELL }, ang)) y += CELL;
    for (let i = 0; i < CELL / LOCK_FINE_STEP; i++) {
      if (y < DROP_Y && !this.collidesAt(b, { x, y: y + LOCK_FINE_STEP }, ang)) y += LOCK_FINE_STEP;
      else break;
    }
    return y;
  }

  // ---- 把活动方块就地设到指定 Y (不做碰撞检查, 调用方须保证安全) --
  snapActiveToY(y) {
    const b = this.active;
    if (!b) return;
    Body.setPosition(b, { x: b.position.x, y });
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

  // ---- 活动方块按偏移量探测是否碰撞 (不实际移动) ----------------
  // 仅查询, collidesAt 内部已保存/恢复位置, 不会留下副作用.
  wouldHitBlock(dx, dy) {
    const b = this.active;
    if (!b) return false;
    return this.collidesAt(b, { x: b.position.x + dx, y: b.position.y + dy }, b.angle);
  }

  // ---- 旋转后把方块吸附回网格格心 ----------------------------------
  // kinematic 阶段是经典俄罗斯方块控制 (非真实刚体旋转): 旋转后再平移
  // <1 格的修正量, 使每个单元格落回 (col+0.5, row+0.5)×CELL 的格心, 方便嵌合.
  // 因同一方块各单元格相对位置恒为整数格, 它们旋转后共享同一小数偏移, 一次平移即可全部对齐.
  _gridSnapOffset(body, angle) {
    const savedAngle = body.angle;
    Body.setAngle(body, angle);                 // 绕当前质心旋转 (质心不动, 各部件移动)
    const p = body.parts.find(p => p !== body);  // 任取一个真实单元格
    const nx = (Math.round(p.position.x / CELL - 0.5) + 0.5) * CELL;
    const ny = (Math.round(p.position.y / CELL - 0.5) + 0.5) * CELL;
    const dx = nx - p.position.x;
    const dy = ny - p.position.y;
    Body.setAngle(body, savedAngle);            // 恢复
    return [dx, dy];
  }

  // ---- 活动方块尝试顺时针旋转 90° (旋转后吸附网格 + wall-kick) ------
  tryRotate() {
    const b = this.active;
    if (!b) return false;
    const newAngle = b.angle + Math.PI / 2;
    const [sx, sy] = this._gridSnapOffset(b, newAngle);  // 旋转后到最近格心的修正量
    const kicks = [
      [0, 0], [-CELL, 0], [CELL, 0], [0, -CELL],
      [-2 * CELL, 0], [2 * CELL, 0], [0, -2 * CELL],
      [-CELL, -CELL], [CELL, -CELL],
    ];
    for (const [kx, ky] of kicks) {
      const np = { x: b.position.x + sx + kx, y: b.position.y + sy + ky };
      if (!this.collidesAt(b, np, newAngle)) {
        Body.setPosition(b, np);
        Body.setAngle(b, newAngle);
        return true;
      }
    }
    return false;
  }

  // ---- 接触触发: 把当前 kinematic 方块就地转为动态刚体 ----------
  // 当 canDescend() 为 false (下一格接触平台或已放置方块) 时由游戏层调用:
  // 方块在当前位置 (最后一个不重叠位置) 转为动态刚体, 由重力 / 摩擦 / 力矩 /
  // 质心接管, 玩家从此失去对该方块的控制权. 返回该 body 供稳定/掉落/计分.
  releaseActive(now, vx = 0, vy = 0) {
    const b = this.active;
    if (!b) return null;
    Body.setStatic(b, false);
    // 关键: kinematic 阶段 enableSleeping 会把静态刚体置为休眠, setStatic 不会自动唤醒;
    // 必须显式唤醒, 否则 Matter 不会对其施加重力 -> 方块卡在顶部不下落.
    Sleeping.set(b, false);
    b.isSleeping = false;
    b.sleepCounter = 0;
    // 重新施加材质 (setStatic 可能重置部分属性). 用刚体自身记录的 matProps,
    // 以保留石块的高密度 -> 更重 (勿硬编码普通密度, 否则石块会变回普通重量).
    const m = b.matProps || { density: BLOCK_DENSITY, friction: BLOCK_FRICTION, frictionStatic: BLOCK_FRICTION_STATIC, restitution: BLOCK_RESTITUTION };
    Body.setDensity(b, m.density);   // 设质量 = density × area (石块 6× 普通)
    b.friction = m.friction;
    b.frictionStatic = m.frictionStatic;
    b.restitution = m.restitution;
    for (const p of b.parts) {
      if (p === b) continue;
      p.friction = m.friction;
      p.frictionStatic = m.frictionStatic;
      p.restitution = m.restitution;
    }
    // 赋予初始水平速度 (横移撞向相邻方块时由 _moveHorizontal 传入).
    // 必须在唤醒之后, 否则被休眠机制覆盖.
    if (vx || vy) Body.setVelocity(b, { x: vx, y: vy });
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
  // 注意: 不能仅凭瞬时低速判定, 否则刚转物理(重力尚未加速)的方块会被误判
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
