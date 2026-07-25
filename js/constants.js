// ============================================================
//  constants.js — 全局配置与枚举
//  对应 AGENT.md:
//    §7 平台宽 10 单位, 3 条命, Y 越界视为掉落
//    §6 计分: S = α·T + Σβ·h_i + γ·H²   (α=1, β=5, γ=10)
//    §9 动作: 5 个 (LEFT/RIGHT/ROT/SOFT/HARD) 用于人类键盘输入映射
// ============================================================

// 画布 / 网格 ------------------------------------------------
const CELL = 30;            // 1 个基础方块 = 30px (1 Unit)
const COLS = 18;             // 画布宽度 = 18 单位 (平台居中, 两侧为深渊)
const ROWS = 24;             // 画布高度 = 24 单位
const CANVAS_W = COLS * CELL;
const CANVAS_H = ROWS * CELL;

// 平台 -------------------------------------------------------
const PLATFORM_WIDTH = 10;                      // 单位 (AGENT.md §2.1)
const PLATFORM_LEFT_COL = (COLS - PLATFORM_WIDTH) / 2;   // = 4
const PLATFORM_TOP_ROW = ROWS - 3;              // 平台顶面所在行 (=21)
const PLATFORM_TOP_Y = PLATFORM_TOP_ROW * CELL; // 平台顶面 y 坐标 (px)
const PLATFORM_HEIGHT = 3 * CELL;               // 平台厚度 (px)

// 物理 -------------------------------------------------------
const GRAVITY_Y = 1.4;        // Matter 引擎重力 (y 向下); 偏大, 使转物理后的自由下落更干脆
const GRAVITY_SCALE = 0.0014; // 重力缩放 (与 density 配合)
const BLOCK_DENSITY = 0.002;  // 方块密度 (影响质量 -> 影响稳定性)
const BLOCK_FRICTION = 0.9;   // 方块间摩擦 (高, 防止轻易滑落)
const BLOCK_FRICTION_STATIC = 1.0;
const BLOCK_RESTITUTION = 0.02; // 弹性 (低, 避免弹跳)
const PLATFORM_FRICTION = 1.0;  // 平台表面高摩擦 (§2.1)
const SLEEPING_ENABLED = true;

// 节奏 -------------------------------------------------------
// 接触触发模型 (AGENT.md §1): kinematic 阶段方块逐格自动下落 (经典俄罗斯方块).
//   每 DROP_INTERVAL_MS 自动下移 1 格; 按住 ↓ (SOFT_DROP) 间隔缩短为
//   SOFT_DROP_INTERVAL_MS; HARD_DROP 瞬间下落到接触.
//   接触平台或已放置方块时, 方块就地转为动态刚体, 交由物理引擎接管.
const DROP_INTERVAL_MS = 500;       // 自然下落间隔
const SOFT_DROP_INTERVAL_MS = DROP_INTERVAL_MS / 2;  // 软降 = 2× 自动下落速度
const LOCK_FINE_STEP = 4;          // 落点预览精细下扫步长 (px)

// 落地吸附真实化 (§1 接触触发) -----------------------------------
// 旧实现把方块精确贴到接触面 (≤LOCK_FINE_STEP 间隙) 且 vy=0, 像被磁铁吸住:
// 无可见下落 / 无冲击 / 无沉淀. 新实现: 在接触面上方留 LOCK_RELEASE_GAP px,
// 并按运动学下落速度 (CELL/DROP_INTERVAL_MS ≈ 3.6 px/步) 赋予向下冲击速度,
// 让方块「最后沉一下」并轻轻冲击堆叠, 视觉与动量都更接近真实.
// 间隙小到求解器 (12/8/3) 在 RELEASE_NO_SLEEP_FRAMES 窗口内即可解算穿透,
// 不会冻结成重叠 (这正是当年精确贴面所要规避的 bug 的根因——休眠冻结穿透).
const LOCK_RELEASE_GAP   = 8;      // 释放时距接触面留的间隙 (px, ~1/4 格)
const LOCK_IMPACT_VEL    = 3.5;    // 释放时向下冲击速度 (px/步) ≈ 运动学下落速度
const RELEASE_NO_SLEEP_FRAMES = 20; // 释放后前 N 帧禁止休眠, 让求解器先解算穿透
const PHYSICS_HZ = 60;
const PHYSICS_DT = 1000 / PHYSICS_HZ;

// 生命 / 掉落 (§2.3) ----------------------------------------
const MAX_LIVES = 3;
// 掉落判定: 方块最低点越过画布底 + 边距 即视为掉入深渊 (等价于 Y<0)
const DROP_Y = CANVAS_H + CELL * 1.0;

// 生成位置 (方块生成于此, kinematic 阶段逐格自动下落) ----------
const SPAWN_X = (PLATFORM_LEFT_COL + PLATFORM_WIDTH / 2) * CELL;
const SPAWN_Y = 2 * CELL;
// 生成区: 方块转物理后须离开此区域, 下一块才生成 (避免与新生成方块重叠卡死)
const SPAWN_CLEAR_X = 2.5 * CELL;   // 生成区半宽
const SPAWN_CLEAR_Y = 1.5 * CELL;   // 生成区下界偏移 (相对 SPAWN_Y)
const SPAWN_FORCE_FRAMES = 180;     // 等待超过此帧则强制生成 (防软锁)

// 计分 (§3.2) -----------------------------------------------
const ALPHA = 1;    // S_time = α·T   (每秒 1 分)
const BETA = 5;      // S_place = Σ β·h_i
const GAMMA = 10;    // S_height = γ·H²

// 稳定性检测 -----------------------------------------------
const STABLE_SPEED = 0.7;    // 速度低于此视为"接近静止" (px/帧)
const STABLE_OMEGA = 0.05;    // 角速度低于此视为接近静止
const STABLE_FRAMES = 25;     // 连续静止帧数 -> 判定稳定
const SLEEP_BONUS = true;     // Matter 休眠也视作稳定

// 动作空间 (接触触发模型) -----------------------------------
// kinematic 阶段: 经典俄罗斯方块控制. 接触平台/已放置方块时自动转物理 (非按键触发).
// 标准动作 = 5: LEFT / RIGHT / ROTATE / SOFT_DROP / HARD_DROP (用于人类键盘输入映射)
const ACTION = {
  MOVE_LEFT: 0,
  MOVE_RIGHT: 1,
  ROTATE_CW: 2,
  SOFT_DROP: 3,      // 下一格 (加速下落); 接触则转物理
  HARD_DROP: 4,      // 瞬间下落到接触, 立即转物理
  NOOP: 99,          // 内部哨兵: 无活动方块时"什么都不做", 不属于标准动作空间
};

// 颜色 -------------------------------------------------------
const COLORS = {
  I: { fill: '#22d3ee', light: '#67e8f9', dark: '#0e7490' },
  O: { fill: '#facc15', light: '#fde68a', dark: '#a16207' },
  T: { fill: '#a855f7', light: '#c4b5fd', dark: '#6b21a8' },
  S: { fill: '#22c55e', light: '#86efac', dark: '#15803d' },
  Z: { fill: '#ef4444', light: '#fca5a5', dark: '#991b1b' },
  J: { fill: '#3b82f6', light: '#93c5fd', dark: '#1e40af' },
  L: { fill: '#f97316', light: '#fdba74', dark: '#9a3412' },
};
const SHAPE_KEYS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

const UI = {
  bg: '#0b1020',
  grid: 'rgba(255,255,255,0.04)',
  gridStrong: 'rgba(255,255,255,0.08)',
  platform: '#1e293b',
  platformEdge: '#475569',
  abyssTint: 'rgba(239,68,68,0.04)',
  text: '#e2e8f0',
  muted: '#94a3b8',
  accent: '#22d3ee',
  danger: '#ef4444',
  good: '#22c55e',
};
