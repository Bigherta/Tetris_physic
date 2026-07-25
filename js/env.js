// ============================================================
//  env.js — 强化学习 MDP 接口 (接触触发模型)
//  Action  : 离散 5 维 (MOVE_LEFT/RIGHT/ROTATE_CW/SOFT_DROP/HARD_DROP)
//  Observation : Option A (heightmap) + Option C (current/next/刚体向量)
//  Reward  : §6 step +0.01 / place +0.5·h / drop -5 / gameover -10
//  一步 = 一个物理模拟帧 (与 §6 "each simulation step +0.01" 一致)
//  注: 方块在 kinematic 阶段逐格自动下落; 接触平台或已放置方块时自动转物理
//      (非按键触发). SOFT_DROP=下一格, HARD_DROP=瞬间下落到接触.
// ============================================================

function oneHot(index, size) {
  const v = new Array(size).fill(0);
  if (index >= 0 && index < size) v[index] = 1;
  return v;
}
const SHAPE_INDEX = { I: 0, O: 1, T: 2, S: 3, Z: 4, J: 5, L: 6 };

class TetrisEnv {
  constructor(game) {
    this.game = game;
    this.actionSpace = ACTION_SPACE_SIZE; // 4
  }

  // ---- 重置环境, 返回初始观测 ---------------------------------
  reset() {
    this.game.reset(true);
    this.game.start();
    return this.getObservation();
  }

  // ---- 执行一步动作 ------------------------------------------
  // 返回 { observation, reward, done, info }
  step(action) {
    if (this.game.state === 'over') {
      return { observation: this.getObservation(), reward: 0, done: true, info: this.getInfo() };
    }
    this.game.applyAction(action);
    this.game.update(PHYSICS_DT);
    const { reward, events } = this.game.flushReward();
    const done = this.game.state === 'over';
    return {
      observation: this.getObservation(),
      reward,
      done,
      info: { ...this.getInfo(), events },
    };
  }

  // ---- 观测空间 ------------------------------------------------
  // Option A: 平台 10 列高度图; Option C: 当前方块 / 下一块 / 已放置刚体向量
  getObservation() {
    const g = this.game;
    const p = g.physics;
    const active = p.active;
    let cur = null;
    if (active) {
      const idx = SHAPE_INDEX[active.pieceShape] ?? -1;
      const rot = Math.round(active.angle / (Math.PI / 2)) % 4;
      cur = {
        shape: oneHot(idx, 7),
        x: (active.position.x - PLATFORM_LEFT_COL * CELL) / CELL,
        y: (PLATFORM_TOP_Y - active.position.y) / CELL,
        rot: ((rot % 4) + 4) % 4,
        angle: active.angle,
      };
    }
    const nextIdx = SHAPE_INDEX[g.nextShape] ?? -1;
    const placed = p.placed.map(b => ({
      x: (b.position.x - PLATFORM_LEFT_COL * CELL) / CELL,
      y: (PLATFORM_TOP_Y - b.position.y) / CELL,
      theta: b.angle,
    }));
    return {
      current: cur,
      next: { shape: oneHot(nextIdx, 7) },
      heightmap: p.heightmap(),
      placed,                        // Option C
      lives: g.lives,
      peak: g.peakHeight,
    };
  }

  // ---- 扁平观测向量 (供 CNN/MLP 直接使用) ----------------------
  // [cur one-hot(7), x, y, rot(4 one-hot), next one-hot(7), heightmap(10), lives, peak]
  flatObservation() {
    const o = this.getObservation();
    const v = [];
    if (o.current) {
      v.push(...o.current.shape);
      v.push(o.current.x, o.current.y);
      v.push(...oneHot(o.current.rot, 4));
    } else {
      v.push(...new Array(7).fill(0), 0, 0, ...new Array(4).fill(0));
    }
    v.push(...o.next.shape);
    v.push(...o.heightmap);
    v.push(o.lives, o.peak);
    return v;
  }

  getInfo() {
    return this.game.scoreInfo();
  }

  actionNames() { return ACTION_NAMES; }
}
