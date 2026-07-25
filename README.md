# Physics Tetris · 真实物理俄罗斯方块

一个把经典俄罗斯方块与 **2D 刚体物理引擎 ([Matter.js](https://brm.io/matter-js/))** 结合的游戏 / 强化学习环境。

**规则**：方块生成后像经典俄罗斯方块一样**逐格自动下落**，玩家用 ← → ↑ 调整位置与方向、↓ 软降加速、空格硬降；**当方块第一次接触悬空平台或已放置方块时**，立即转为动态刚体，完全交由物理引擎（重力 / 摩擦 / 力矩 / 质心）接管，玩家**不再拥有控制权**。堆得越高越容易倾覆，掉落 3 次即结束。

规格依据：[demo.txt](demo.txt)（两阶段模型）与 [AGENT.md](AGENT.md)（接触触发，动作空间 5）。

## 运行

直接用浏览器打开 `index.html` 即可（Matter.js 已 vendor 到 `vendor/`，离线可用）。
若个别浏览器对 `file://` 限制较严，可起一个本地静态服务器：

```bash
python3 -m http.server 8000   # 然后访问 http://localhost:8000
```

## 操作

| 键 | 功能 |
|---|---|
| ← → | 左右移动方块（可长按连发） |
| ↑ | 顺时针旋转 90°（带 wall-kick） |
| ↓ | 软降：加速逐格下落（可长按） |
| 空格 | 硬降：瞬间下落到接触，立即转物理 |
| P | 暂停 / 继续 |
| R | 重开 |

> 方块在 kinematic 阶段逐格自动下落、玩家可控；接触平台或已放置方块时**自动**转为动态刚体（非按键触发）。转物理后待方块离开顶部生成区，下一块才会出现（避免与新生成方块重叠）。

右侧面板可切换 **人类 / AI·贪心 / AI·随机** 三种模式，并调节 AI 决策速度。

## 计分（AGENT.md §6）

```
S_total = S_time + S_place + S_height
S_time  = α·T            (α=1,   每秒 1 分, 存活成本极低)
S_place = Σ β·h_i        (β=5,   每块稳定后按质心高度奖励)
S_height= γ·H²           (γ=10,  历史最高稳定高度, 二次增长, 主得分项)
```

- 生命 = 3；任一方块坠出画布底部（Y 越界）即扣 1 命并移除其得分贡献。
- “稳定”= 刚体进入休眠（sleep）或持续低速静止达阈值帧数。

## 强化学习接口（AGENT.md §6）

打开浏览器控制台即可直接驱动 MDP：

```js
env.reset();                       // -> observation
const {observation, reward, done, info} = env.step(ACTION.HARD_DROP);
// 动作空间 5: ACTION.{MOVE_LEFT,MOVE_RIGHT,ROTATE_CW,SOFT_DROP,HARD_DROP}
//   SOFT_DROP = 下一格; HARD_DROP = 瞬间下落到接触
//   接触平台/已放置方块时自动转物理 (非按键触发)
env.flatObservation();             // -> 数组(32): 当前块one-hot+x+y+rot + 下一块one-hot + heightmap(10) + lives + peak
```

> 转物理后到下一块出现之间，`obs.current` 可能为 `null`（生成区未清空），此时 agent 应返回 `ACTION.NOOP`（内部哨兵，不计入 5 维动作空间）。

观测同时提供 Option A（平台 10 列 heightmap）与 Option C（已放置刚体的 `(x,y,θ)` 向量列表）。
RL 奖励：步 `+0.01`、放置 `+0.5·h`、掉落 `-5`、结束 `-10`。
页面内不再内置演示 AI；接入真·RL 算法库只需在浏览器控制台用 `env.reset/step/flatObservation` 驱动（`window.env` / `window.ACTION`）。

## 文件结构

```
index.html              入口 / 布局 / 脚本加载顺序
css/style.css           暗色主题与 HUD 样式
vendor/matter.min.js    2D 刚体物理引擎 (本地, 离线可用)
js/constants.js         全局配置: 网格 / 物理 / 计分 / RL 参数 / 动作枚举 / 下落间隔
js/shapes.js            七种方块的单元格定义与质心
js/physics.js           Matter 世界: 平台 / 复合刚体 / 碰撞预测 / canDescend / 接触转物理 / 掉落 / 休眠 / heightmap
js/renderer.js          Canvas 渲染: 背景 / 深渊 / 网格 / 平台 / 贴片方块 / 落点预览 / 下一块
js/game.js              状态机: 生成 / 动作 / 自动下落 / 接触转物理 / 稳定 / 计分 / 生命 / 结束
js/env.js               MDP 包装: reset / step / observation / reward (§6)
js/main.js              启动 / 主循环 / 键盘 / HUD
```

## 物理关键点

- **两态切换（接触触发）**：方块生成时为 Matter `isStatic`（kinematic，不受重力），逐格自动下落，玩家 / AI 通过碰撞预测（`Query.collides`）用 ← → ↑ ↓ 离散调整；当 `canDescend()` 为 false（下一格即接触平台或已放置方块）时，在当前位置（最后一个不重叠位置）`Body.setStatic(body,false)` + `Sleeping.set(body,false)` 转为动态刚体，受重力 / 摩擦 / 力矩支配，玩家从此失去控制权。
- **生成节奏**：转物理后不立即生成下一块；待已下方块离开顶部生成区（`isSpawnClear`），下一块才出现，避免与新生成方块重叠卡死。
- **质心**：方块以 4 个 1×1 单元复合而成，质心由 Matter 自动计算；旋转绕质心，与真实刚体一致。
- **倾覆**：结构整体质心落在平台水平支撑之外或产生不稳力矩时，自然旋转 / 滑移 / 坍塌。
- **深渊**：平台仅 10 单位宽且**无侧墙**；可故意把方块移到平台外再让它下落，观察其倾倒坠入深渊并扣命。
