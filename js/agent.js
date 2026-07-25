// ============================================================
//  agent.js — 演示用 AI Agent (走 env 接口, 不训练)
//  HeuristicAgent: 平整化贪心 — 总把方块塞进当前最低的"3 列谷地",
//                  保持 COM 在平台内部以减少倾覆, 从而堆高得分.
//  RandomAgent   : 随机动作, 作为基线对照.
//  真正的 RL 训练请用 env.reset/step + flatObservation() 接入算法库.
// ============================================================

class HeuristicAgent {
  constructor() { this.name = 'heuristic'; }

  // obs: TetrisEnv.getObservation(); info: scoreInfo()
  act(obs, info) {
    if (!obs || !obs.current) return ACTION.NOOP;

    const hm = obs.heightmap;            // 平台 10 列高度图 (单位)
    const cur = obs.current;

    // 若姿态非 0 (理论上不会发生, 活动方块不受物理旋转), 先转正
    if (cur.rot !== 0) return ACTION.ROTATE_CW;

    // 评分每个候选中心列 c∈[1,8] (保证 3 宽 footprint 不悬空于平台外)
    // cost = 局部最高高度(落地高度)×2 + 相邻不平整度×0.5
    let bestC = 4, bestCost = Infinity;
    for (let c = 1; c <= PLATFORM_WIDTH - 2; c++) {
      const a = hm[c - 1] ?? 0, b = hm[c] ?? 0, d = hm[c + 1] ?? 0;
      const local = Math.max(a, b, d);
      const uneven = Math.abs(a - b) + Math.abs(b - d);
      const cost = local * 2 + uneven * 0.5;
      if (cost < bestCost) { bestCost = cost; bestC = c; }
    }

    const targetX = bestC + 0.5;          // 目标列中心 (平台坐标)
    const cx = cur.x;                      // 当前方块质心 x (平台坐标)
    const tol = 0.4;

    if (cx < targetX - tol) return ACTION.MOVE_RIGHT;
    if (cx > targetX + tol) return ACTION.MOVE_LEFT;
    return ACTION.HARD_DROP;             // 对齐 -> 释放, 让物理接管
  }
}

class RandomAgent {
  constructor(dropProb = 0.12) {
    this.name = 'random';
    this.dropProb = dropProb;
  }
  act(obs, info) {
    if (!obs || !obs.current) return ACTION.NOOP;
    if (Math.random() < this.dropProb) return ACTION.HARD_DROP;
    const pool = [ACTION.MOVE_LEFT, ACTION.MOVE_RIGHT, ACTION.ROTATE_CW];
    return pool[(Math.random() * pool.length) | 0];
  }
}
