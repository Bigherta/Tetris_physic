// ============================================================
//  settings.js — 可配置的按键映射与横移速度
//  - 默认: 左 ← / 右 → / 旋转 ↑ / 软降 ↓ / 硬降 空格
//  - 横移速度可调 (px/s); 持久化到 localStorage
//  - 通过快捷键 O 打开设置界面
// ============================================================

const DEFAULT_KEYS = {
  left:  'ArrowLeft',
  right: 'ArrowRight',
  rotate:'ArrowUp',
  soft:  'ArrowDown',
  hard:  ' ',
};
const DEFAULT_MOVE_SPEED_CELL = 14;   // 横移速度 (格/秒) -> HORIZONTAL_SPEED = n * CELL

const KEY_LABEL = {
  ' ': 'Space',
  'ArrowLeft': '←',
  'ArrowRight': '→',
  'ArrowUp': '↑',
  'ArrowDown': '↓',
};
function keyLabel(k){ return KEY_LABEL[k] || (k.length===1 ? k.toUpperCase() : k); }

const Settings = {
  keys: { ...DEFAULT_KEYS },
  moveSpeedCell: DEFAULT_MOVE_SPEED_CELL,   // 格/秒

  load(){
    try{
      const s = JSON.parse(localStorage.getItem('pt_settings') || '{}');
      if(s.keys) Object.assign(this.keys, s.keys);
      if(typeof s.moveSpeedCell==='number') this.moveSpeedCell = s.moveSpeedCell;
    }catch(e){}
    // 兜底: 任一键缺失则用默认
    for(const k in DEFAULT_KEYS) if(!this.keys[k]) this.keys[k]=DEFAULT_KEYS[k];
  },
  save(){
    try{ localStorage.setItem('pt_settings', JSON.stringify({keys:this.keys, moveSpeedCell:this.moveSpeedCell})); }catch(e){}
  },
  reset(){
    this.keys = { ...DEFAULT_KEYS };
    this.moveSpeedCell = DEFAULT_MOVE_SPEED_CELL;
    this.save();
  },
  // 当前横移速度 px/s
  get moveSpeed(){ return this.moveSpeedCell * CELL; },
  // 单次轻点位移 (与速度成比例, 约 0.032 秒的位移)
  get tapDist(){ return this.moveSpeed * 0.032; },
  // Matter 用的 px/步
  moveVelPerStep(){ return this.moveSpeed * PHYSICS_DT / 1000; },

  // 由按键事件 -> 动作 (返回 ACTION.* 或 null)
  actionFor(key){
    for(const act in this.keys) if(this.keys[act]===key) return ACTION[
      {left:'MOVE_LEFT',right:'MOVE_RIGHT',rotate:'ROTATE_CW',soft:'SOFT_DROP',hard:'HARD_DROP'}[act]
    ];
    return null;
  },
};

Settings.load();
