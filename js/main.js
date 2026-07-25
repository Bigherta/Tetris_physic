// ============================================================
//  main.js — 启动 / 主循环 / 输入 / HUD
//  仅人类游玩
// ============================================================

(function () {
  // ---- DOM ----
  const canvas = document.getElementById('canvas');
  const nextCanvas = document.getElementById('nextCanvas');
  const overlay = document.getElementById('overlay');
  const $ = (id) => document.getElementById(id);

  // ---- 游戏与环境 ----
  const game = new Game(canvas, nextCanvas);

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

    // 设置面板打开时: 拦截一切用于重绑键; Esc 关闭; O 切换关闭
    if (settingsOpen) {
      if (k === 'Escape') { closeSettings(); e.preventDefault(); }
      else if (listeningKey && k !== 'Tab' && k !== 'Shift' && k !== 'Control' && k !== 'Alt' && k !== 'Meta') {
        // 绑定该键 (允许 ArrowKeys / 空格 / 字母数字)
        Settings.keys[listeningKey] = k;
        Settings.save();
        listeningKey = null;
        renderKeyBinds();
        e.preventDefault();
      }
      return;
    }

    // 任意键开始
    if (game.state === 'ready' && !e.repeat) {
      startGame();
      const known = Object.values(Settings.keys).includes(k);
      if (known) e.preventDefault();
      return;
    }
    if (k === 'o' || k === 'O') { toggleSettings(); e.preventDefault(); return; }
    if (k === 'p' || k === 'P') { togglePause(); e.preventDefault(); return; }
    if (k === 'r' || k === 'R') { resetGame(); e.preventDefault(); return; }
    if (game.state !== 'playing') return;

    // 按设置中的按键映射触发对应动作
    const act = Settings.actionFor(k);
    if (act === null) return;
    e.preventDefault();
    if (act === ACTION.MOVE_LEFT) {
      if (!e.repeat) game.applyAction(ACTION.MOVE_LEFT);
      game.keys.left = true;
    } else if (act === ACTION.MOVE_RIGHT) {
      if (!e.repeat) game.applyAction(ACTION.MOVE_RIGHT);
      game.keys.right = true;
    } else if (act === ACTION.ROTATE_CW) {
      if (!e.repeat) game.applyAction(ACTION.ROTATE_CW);
    } else if (act === ACTION.SOFT_DROP) {
      if (!e.repeat) game.applyAction(ACTION.SOFT_DROP);
      game.keys.down = true;
    } else if (act === ACTION.HARD_DROP) {
      if (!e.repeat) game.applyAction(ACTION.HARD_DROP);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (Settings.keys.left  === e.key) game.keys.left  = false;
    if (Settings.keys.right === e.key) game.keys.right = false;
    if (Settings.keys.soft  === e.key) game.keys.down  = false;
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

  // ============ 设置面板 ============
  const settingsOverlay = $('settingsOverlay');
  const keyBindList = $('keyBindList');
  const moveSpeedSlider = $('moveSpeedSlider');
  const moveSpeedVal = $('moveSpeedVal');
  let settingsOpen = false;
  let listeningKey = null;     // 当前正在等待重绑的设置键名 (left/right/rotate/soft/hard)

  const KEY_BIND_ROWS = [
    { id: 'left',   label: '左移',   sub: 'Move Left' },
    { id: 'right',  label: '右移',   sub: 'Move Right' },
    { id: 'rotate', label: '旋转',   sub: 'Rotate' },
    { id: 'soft',   label: '软降',   sub: 'Soft Drop' },
    { id: 'hard',   label: '硬降',   sub: 'Hard Drop' },
  ];

  function renderKeyBinds() {
    keyBindList.innerHTML = '';
    for (const row of KEY_BIND_ROWS) {
      const k = Settings.keys[row.id];
      const wrap = document.createElement('div');
      wrap.className = 'key-bind-row';
      const label = document.createElement('div');
      label.className = 'label';
      label.innerHTML = `${row.label}<span class="sub">${row.sub}</span>`;
      const cap = document.createElement('div');
      cap.className = 'keycap' + (listeningKey === row.id ? ' listening' : '');
      cap.textContent = listeningKey === row.id ? '按任意键…' : keyLabel(k);
      cap.addEventListener('click', () => {
        listeningKey = (listeningKey === row.id) ? null : row.id;
        renderKeyBinds();
      });
      wrap.appendChild(label);
      wrap.appendChild(cap);
      keyBindList.appendChild(wrap);
    }
  }

  function renderMoveSpeed() {
    moveSpeedSlider.value = Settings.moveSpeedCell;
    moveSpeedVal.textContent = Settings.moveSpeedCell + ' 格/秒';
  }

  function openSettings() {
    if (settingsOpen) return;
    settingsOpen = true;
    listeningKey = null;
    renderKeyBinds();
    renderMoveSpeed();
    settingsOverlay.classList.remove('hidden');
    // 打开设置时自动暂停
    if (game.state === 'playing') game.pause();
  }
  function closeSettings() {
    if (!settingsOpen) return;
    settingsOpen = false;
    listeningKey = null;
    settingsOverlay.classList.add('hidden');
    // 关闭设置时若游戏处于暂停态, 显示暂停界面 (此前被设置面板遮住)
    if (game.state === 'paused') showOverlay('PAUSED', null, '按 P 或点击“开始”继续');
  }
  function toggleSettings() {
    if (settingsOpen) closeSettings(); else openSettings();
  }

  moveSpeedSlider.addEventListener('input', () => {
    Settings.moveSpeedCell = parseInt(moveSpeedSlider.value, 10);
    moveSpeedVal.textContent = Settings.moveSpeedCell + ' 格/秒';
    Settings.save();
  });

  $('btn-settings').addEventListener('click', toggleSettings);
  $('settings-close').addEventListener('click', closeSettings);
  $('settings-save').addEventListener('click', closeSettings);
  $('settings-reset').addEventListener('click', () => {
    Settings.reset();
    renderKeyBinds();
    renderMoveSpeed();
  });
  // 点击遮罩空白处关闭
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });

  // ---- 暴露给控制台, 方便 RL 实验 ----
  window.game = game;
  window.ACTION = ACTION;
  console.log('%cPhysics Tetris 已就绪', 'color:#22d3ee;font-weight:bold');
  console.log('  操作: ←→↑ 移动/旋转 · ↓ 软降 · 空格 硬降 · P 暂停 · R 重开');
})();
