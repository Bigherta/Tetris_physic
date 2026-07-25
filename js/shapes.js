// ============================================================
//  shapes.js — 七种俄罗斯方块定义
//  每个方块由 4 个 1×1 单元格组成, 以"单元格中心"坐标给出,
//  坐标原点设在该方块的质心附近, 这样 Matter 的 setAngle 绕质心旋转,
//  物理上与真实刚体一致 (AGENT.md §2.2 "Center of Mass").
// ============================================================

// 单元格中心偏移 (单位 = CELL), y 向下
// 所有偏移均为半整数 (±0.5, ±1.5 ...), 这样当部件生成参考点 (px,py) 取整数倍 CELL 时,
// 每个单元格中心恰好落在网格格心 (col+0.5, row+0.5) × CELL, 方块之间可像经典俄罗斯
// 方块那样严丝合缝地嵌合. Body.create 会自动算出质心 (body.position = 部件质心),
// 故无需再用 setPosition 强制覆盖质心 (那样会把方块整体推离网格).
const SHAPES = {
  // 4 连横
  I: [[-1.5, 0.5], [-0.5, 0.5], [0.5, 0.5], [1.5, 0.5]],
  // 2×2 方块 (质心恰在中心, 旋转不变)
  O: [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]],
  // T: 底排 3 格 + 上凸 1 格
  T: [[-0.5, 0.5], [0.5, 0.5], [1.5, 0.5], [0.5, -0.5]],
  // S: 右上左下
  S: [[0.5, -0.5], [1.5, -0.5], [-0.5, 0.5], [0.5, 0.5]],
  // Z: 左上右下
  Z: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [1.5, 0.5]],
  // J: 左竖 + 底排
  J: [[-0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [1.5, 0.5]],
  // L: 右竖 + 底排
  L: [[1.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [1.5, 0.5]],
};

// 每种方块的颜色
function colorOf(key) {
  return COLORS[key];
}

// 计算给定单元格集合的质心 (单位坐标)
function centroidOf(cells) {
  let cx = 0, cy = 0;
  for (const c of cells) { cx += c[0]; cy += c[1]; }
  return [cx / cells.length, cy / cells.length];
}

// 将单元格集合顺时针旋转 90° (用于 agent 目标规划; 实际旋转由 Matter 完成)
function rotateCW(cells) {
  // (x, y) -> (-y, x)  (屏幕坐标 y 向下时的顺时针)
  return cells.map(([x, y]) => [-y, x]);
}

// 7-bag 随机器 (标准俄罗斯方块): 把 7 种方块打乱成一袋, 依次发放; 袋空后重新洗牌.
// 保证每 7 块内每种各出现一次, 避免连续生成相同方块.
class PieceBag {
  constructor() { this.bag = []; this._refill(); }
  _refill() {
    this.bag = SHAPE_KEYS.slice();
    // Fisher-Yates 洗牌
    for (let i = this.bag.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = this.bag[i]; this.bag[i] = this.bag[j]; this.bag[j] = t;
    }
  }
  next() {
    if (this.bag.length === 0) this._refill();
    return this.bag.pop();
  }
  reset() { this.bag = []; this._refill(); }
}

// 方块包围盒 (单位), 用于碰撞/渲染参考
function boundsOf(cells) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of cells) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
