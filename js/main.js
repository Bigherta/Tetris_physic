// ============================================================
//  main.js — 启动 / 主循环 / 输入 / HUD
//  仅人类游玩; RL 通过浏览器控制台的 env.reset/step 驱动 (见 env.js)
// ============================================================

(function () {
  // ---- DOM ----
  const canvas = document.getElementById('canvas');
  const nextCanvas = document.getElementById('nextCanvas');
  const overlay = document.getElementById('overlay');
  const $ = (id) => document.getElementById(id);

  // ---- 游戏与环境 ----
  const game = new Game(canvas, nextCanvas);
  const env = new TetrisEnv(game);   // 控制台 RL 接口 (不参与画面自动游玩)

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
      game.pause();
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

  // ---- 键盘输入 ----
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    // 任意键开始
    if (game.state === 'ready' && !e.repeat) {
      startGame();
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(k)) e.preventDefault();
      return;
    }
    if (k === 'p' || k === 'P') { togglePause(); e.preventDefault(); return; }
    if (k === 'r' || k === 'R') { resetGame(); e.preventDefault(); return; }
    if (game.state !== 'playing') return;

    // 接触触发模型: ← → ↑ 移动/旋转, ↓ 软降 (可长按加速), 空格 硬降
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
      case 'ArrowDown':
        if (!e.repeat) game.applyAction(ACTION.SOFT_DROP);   // 立即下一格
        game.keys.down = true; e.preventDefault(); break;
      case ' ':
        if (!e.repeat) game.applyAction(ACTION.HARD_DROP);    // 瞬间下落到接触 -> 物理
        e.preventDefault(); break;
    }
  });
  window.addEventListener('keyup', (e) => {
    switch (e.key) {
      case 'ArrowLeft': game.keys.left = false; break;
      case 'ArrowRight': game.keys.right = false; break;
      case 'ArrowDown': game.keys.down = false; break;
    }
  });

  // ---- 主循环 ----
  let last = performance.now();
  function loop(now) {
    let dt = now - last;
    last = now;
    if (dt > 50) dt = 50;

    if (game.state === 'playing') game.update(dt);
    game.render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---- 暴露给控制台, 方便 RL 实验 ----
  window.game = game;
  window.env = env;
  window.ACTION = ACTION;
  console.log('%cPhysics Tetris 已就绪', 'color:#22d3ee;font-weight:bold');
  console.log('  操作: ←→↑ 移动/旋转 · ↓ 软降 · 空格 硬降 · P 暂停 · R 重开');
  console.log('  控制台 RL: env.reset() -> env.step(ACTION.HARD_DROP)  (window.ACTION)');
})();
