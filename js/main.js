// ============================================================
//  main.js — 启动 / 主循环 / 输入 / 模式切换 / HUD
// ============================================================

(function () {
  // ---- DOM ----
  const canvas = document.getElementById('canvas');
  const nextCanvas = document.getElementById('nextCanvas');
  const overlay = document.getElementById('overlay');
  const $ = (id) => document.getElementById(id);

  // ---- 游戏与环境 ----
  const game = new Game(canvas, nextCanvas);
  const env = new TetrisEnv(game);

  // 模式
  let mode = 'human';                 // 'human' | 'heuristic' | 'random'
  let agent = null;
  let aiInterval = 90;                 // ms / 决策
  let aiAccum = 0;

  // ---- HUD 渲染 ----
  function renderLives(lives) {
    const el = $('lives');
    el.innerHTML = '';
    for (let i = 0; i < MAX_LIVES; i++) {
      const h = document.createElement('div');
      h.className = 'heart' + (i >= lives ? ' lost' : '');
      el.appendChild(h);
    }
  }

  function renderHUD(info) {
    renderLives(info.lives);
    $('stime').textContent = info.sTime.toFixed(0);
    $('splace').textContent = info.sPlace.toFixed(0);
    $('sheight').textContent = info.sHeight.toFixed(0);
    $('total').textContent = info.total.toFixed(0);
    $('peak').textContent = info.peak.toFixed(1);
    $('time').textContent = info.time.toFixed(1) + 's';
    $('placed').textContent = info.placed;
    $('dropped').textContent = info.dropped;
  }

  // 游戏每帧回调
  game.onUpdate = (info) => renderHUD(info);
  game.onGameOver = (info, reason) => showOverlay('GAME OVER',
    `<div class="row"><span class="muted">结束原因</span><span>${reason}</span></div>` +
    `<div class="row"><span class="muted">存活时间</span><span>${info.time.toFixed(1)}s</span></div>` +
    `<div class="row"><span class="muted">峰值高度 H</span><span>${info.peak.toFixed(1)}</span></div>` +
    `<div class="row"><span class="muted">已放置 / 掉落</span><span>${info.placed}/${info.dropped}</span></div>` +
    `<div class="row"><span class="muted">S_time</span><span>${info.sTime.toFixed(0)}</span></div>` +
    `<div class="row"><span class="muted">S_place</span><span>${info.sPlace.toFixed(0)}</span></div>` +
    `<div class="row"><span class="muted">S_height</span><span>${info.sHeight.toFixed(0)}</span></div>`,
    `总分 ${info.total.toFixed(0)} · 按 R 或 点击“重开”再来一局`);

  // 初次渲染
  renderHUD(game.scoreInfo());
  game.render();

  // ---- 覆盖层 ----
  function showOverlay(title, html, hint) {
    overlay.classList.remove('hidden');
    overlay.querySelector('h1').textContent = title;
    const breakEl = $('overlayBreak');
    if (html) breakEl.innerHTML = html;
    overlay.querySelector('.hint').textContent = hint || '';
  }
  function hideOverlay() { overlay.classList.add('hidden'); }

  // ---- 启动 / 暂停 / 重开 ----
  function startGame() {
    if (game.state === 'ready' || game.state === 'over') {
      if (game.state === 'over') game.reset(true);
      game.start();
      hideOverlay();
    } else if (game.state === 'paused') {
      game.pause(); // 切回 playing
      hideOverlay();
    }
  }
  function togglePause() {
    if (game.state === 'playing') {
      game.pause();
      showOverlay('PAUSED', null, '按 P 或点击“开始”继续');
    } else if (game.state === 'paused') {
      game.pause();
      hideOverlay();
    }
  }
  function resetGame() {
    game.reset(true);
    game.render();
    showOverlay('PHYSICS TETRIS',
      `<div class="row"><span class="muted">存活得分 S_time</span><span>α·T (1 分/秒)</span></div>` +
      `<div class="row"><span class="muted">放置得分 S_place</span><span>Σ 5·h_i</span></div>` +
      `<div class="row"><span class="muted">高度得分 S_height</span><span>10·H²</span></div>`,
      '按任意键 / 点击“开始”启动');
  }

  $('btn-start').addEventListener('click', startGame);
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-reset').addEventListener('click', resetGame);

  // ---- 模式切换 ----
  function setMode(m) {
    mode = m;
    ['human', 'heuristic', 'random'].forEach(k =>
      $('mode-' + k).classList.toggle('active', k === m));
    if (m === 'human') agent = null;
    else if (m === 'heuristic') agent = new HeuristicAgent();
    else if (m === 'random') agent = new RandomAgent();
    aiAccum = 0;
    // 切到 AI 时若处于就绪态, 自动开始
    if (agent && (game.state === 'ready')) startGame();
  }
  $('mode-human').addEventListener('click', () => setMode('human'));
  $('mode-heuristic').addEventListener('click', () => setMode('heuristic'));
  $('mode-random').addEventListener('click', () => setMode('random'));

  // AI 速度滑块
  const speedSlider = $('ai-speed');
  speedSlider.addEventListener('input', () => {
    aiInterval = +speedSlider.value;
    $('ai-speed-val').textContent = aiInterval + 'ms';
  });

  // ---- 键盘输入 ----
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    // 任意键开始
    if (game.state === 'ready' && !e.repeat) {
      startGame();
      if (['ArrowLeft','ArrowRight','ArrowUp',' '].includes(k)) e.preventDefault();
      return;
    }
    if (k === 'p' || k === 'P') { togglePause(); e.preventDefault(); return; }
    if (k === 'r' || k === 'R') { resetGame(); e.preventDefault(); return; }
    if (game.state !== 'playing') return;

    // 新规则: 仅 ← → ↑ 调整悬挂方块, 空格 释放 (无软降)
    switch (k) {
      case 'ArrowLeft':
        if (!e.repeat) game.applyAction(ACTION.MOVE_LEFT);
        game.keys.left = true; e.preventDefault(); break;
      case 'ArrowRight':
        if (!e.repeat) game.applyAction(ACTION.MOVE_RIGHT);
        game.keys.right = true; e.preventDefault(); break;
      case 'ArrowUp':
        if (!e.repeat) game.applyAction(ACTION.ROTATE_CW);
        e.preventDefault(); break;
      case ' ':
        if (!e.repeat) game.applyAction(ACTION.HARD_DROP);   // 释放 -> 物理接管
        e.preventDefault(); break;
    }
  });
  window.addEventListener('keyup', (e) => {
    switch (e.key) {
      case 'ArrowLeft': game.keys.left = false; break;
      case 'ArrowRight': game.keys.right = false; break;
    }
  });

  // ---- 主循环 ----
  let last = performance.now();
  function loop(now) {
    let dt = now - last;
    last = now;
    if (dt > 50) dt = 50;

    if (game.state === 'playing') {
      if (mode === 'human' || !agent) {
        game.update(dt);
      } else {
        // AI: 每 aiInterval ms 决策一次, 其间正常推进物理 (累积奖励, 下次 step 刷新)
        aiAccum += dt;
        if (aiAccum >= aiInterval) {
          aiAccum -= aiInterval;
          const obs = env.getObservation();
          const info = game.scoreInfo();
          const a = agent.act(obs, info);
          env.step(a);
        } else {
          game.update(dt);
        }
      }
    }
    game.render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---- 暴露给控制台, 方便 RL 实验 ----
  window.game = game;
  window.env = env;
  window.ACTION = ACTION;
  window.HeuristicAgent = HeuristicAgent;
  window.RandomAgent = RandomAgent;
  console.log('%cPhysics Tetris 已就绪', 'color:#22d3ee;font-weight:bold');
  console.log('  人类: 方向键 + 空格   |   AI: 右侧切换模式');
  console.log('  控制台可用: env.reset() -> env.step(ACTION.HARD_DROP)  (window.ACTION)');
})();
