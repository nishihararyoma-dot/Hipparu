const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// 合成画像を保持するオフスクリーンキャンバス
const offCanvas = document.createElement('canvas');
const offCtx = offCanvas.getContext('2d');

// アプリの状態
let mode = 'edit'; // 'edit' | 'pin' | 'pull'
let bgConfig = { type: 'solid', color1: '#ffffff', color2: '#a2d2ff', img: null };
let layers = []; // { id, name, img, x, y, scale, rotation }
let selectedLayerId = null;

// 引っ張り（メッシュ＆ピン留め）用
let pinArea = null; // { x, y, radius } 指定されている場合のみここが引っ張れる
let pinRadius = 80;
let stiffness = 0.16;
const damping = 0.82;
const COLS = 28;
const ROWS = 28;
let points = [];

// キャンバスサイズとメッシュの初期化（画像比率に合わせる）
function resizeWorkspace(width, height) {
  // 最大幅を600px程度に収めつつ比率を維持
  const maxDim = 600;
  let w = width;
  let h = height;
  if (w > maxDim || h > maxDim) {
    if (w > h) {
      h = Math.round((h / w) * maxDim);
      w = maxDim;
    } else {
      w = Math.round((w / h) * maxDim);
      h = maxDim;
    }
  }
  canvas.width = w;
  canvas.height = h;
  offCanvas.width = w;
  offCanvas.height = h;
  pinArea = null;
  initMesh();
  renderComposite();
}

function initMesh() {
  points = [];
  for (let r = 0; r <= ROWS; r++) {
    for (let c = 0; c <= COLS; c++) {
      const x = (c / COLS) * canvas.width;
      const y = (r / ROWS) * canvas.height;
      points.push({
        ox: x, oy: y,
        x: x, y: y,
        vx: 0, vy: 0,
        grabbed: false
      });
    }
  }
}

// 背景と全レイヤーをオフスクリーンキャンバスに合成
function renderComposite() {
  const w = offCanvas.width;
  const h = offCanvas.height;
  offCtx.clearRect(0, 0, w, h);

  // 1. 背景描画
  if (bgConfig.img) {
    offCtx.drawImage(bgConfig.img, 0, 0, w, h);
  } else {
    drawGeneratedBackground(offCtx, w, h);
  }

  // 2. 重ねたレイヤーを順番に描画
  for (let layer of layers) {
    offCtx.save();
    offCtx.translate(layer.x, layer.y);
    offCtx.rotate((layer.rotation * Math.PI) / 180);
    const lw = layer.img.width * layer.scale;
    const lh = layer.img.height * layer.scale;
    offCtx.drawImage(layer.img, -lw / 2, -lh / 2, lw, lh);
    offCtx.restore();
  }
}

// 背景パターンの生成描画
function drawGeneratedBackground(context, w, h) {
  const { type, color1, color2 } = bgConfig;
  if (type === 'solid') {
    context.fillStyle = color1;
    context.fillRect(0, 0, w, h);
  } else if (type === 'gradient') {
    const grad = context.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, color1);
    grad.addColorStop(1, color2);
    context.fillStyle = grad;
    context.fillRect(0, 0, w, h);
  } else if (type === 'dots') {
    context.fillStyle = color1;
    context.fillRect(0, 0, w, h);
    context.fillStyle = color2;
    const step = 24;
    for (let y = 12; y < h; y += step) {
      for (let x = 12; x < w; x += step) {
        context.beginPath();
        context.arc(x, y, 5, 0, Math.PI * 2);
        context.fill();
      }
    }
  } else if (type === 'check') {
    const size = 30;
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        const isEven = ((x / size) + (y / size)) % 2 === 0;
        context.fillStyle = isEven ? color1 : color2;
        context.fillRect(x, y, size, size);
      }
    }
  }
}

// 三角形メッシュ変形描画
function drawTexturedTriangle(p0, p1, p2) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.closePath();
  ctx.clip();

  const x0 = p0.ox, y0 = p0.oy;
  const x1 = p1.ox, y1 = p1.oy;
  const x2 = p2.ox, y2 = p2.oy;

  const u0 = p0.x, v0 = p0.y;
  const u1 = p1.x, v1 = p1.y;
  const u2 = p2.x, v2 = p2.y;

  const delta = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(delta) > 0.001) {
    const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / delta;
    const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / delta;
    const c = ((x1 - x0) * (u2 - u0) - (x2 - x0) * (u1 - u0)) / delta;
    const d = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / delta;
    const e = u0 - a * x0 - c * y0;
    const f = v0 - b * x0 - d * y0;

    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(offCanvas, 0, 0);
  }
  ctx.restore();
}

// メインアニメーションループ
function animate(isSaving = false) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // バネ物理演算
  for (let p of points) {
    if (!p.grabbed) {
      const fx = (p.ox - p.x) * stiffness;
      const fy = (p.oy - p.y) * stiffness;
      p.vx = (p.vx + fx) * damping;
      p.vy = (p.vy + fy) * damping;
      p.x += p.vx;
      p.y += p.vy;
    }
  }

  // メッシュ描画
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i0 = r * (COLS + 1) + c;
      const i1 = i0 + 1;
      const i2 = (r + 1) * (COLS + 1) + c;
      const i3 = i2 + 1;

      drawTexturedTriangle(points[i0], points[i1], points[i2]);
      drawTexturedTriangle(points[i1], points[i3], points[i2]);
    }
  }

  // 保存時以外はガイド枠を表示
  if (!isSaving) {
    // 編集モード時：選択中レイヤーの枠を表示
    if (mode === 'edit' && selectedLayerId) {
      const layer = layers.find(l => l.id === selectedLayerId);
      if (layer) {
        ctx.save();
        ctx.translate(layer.x, layer.y);
        ctx.rotate((layer.rotation * Math.PI) / 180);
        const lw = layer.img.width * layer.scale;
        const lh = layer.img.height * layer.scale;
        ctx.strokeStyle = '#1877f2';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(-lw / 2, -lh / 2, lw, lh);
        ctx.restore();
      }
    }

    // 引っ張り指定エリアの表示（ピン留めモード or 引っ張りモード時）
    if ((mode === 'pin' || mode === 'pull') && pinArea) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(pinArea.x, pinArea.y, pinArea.radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(228, 30, 63, 0.8)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.fillStyle = 'rgba(228, 30, 63, 0.1)';
      ctx.fill();
      ctx.restore();
    }
  }

  if (!isSaving) {
    requestAnimationFrame(() => animate(false));
  }
}

// ポインター座標取得
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width),
    y: (clientY - rect.top) * (canvas.height / rect.height)
  };
}

let isDragging = false;
let dragOffset = { x: 0, y: 0 };

canvas.addEventListener('pointerdown', (e) => {
  isDragging = true;
  const pos = getPos(e);

  if (mode === 'edit') {
    // クリックした位置にある一番上のレイヤーを選択
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      const hw = (l.img.width * l.scale) / 2;
      const hh = (l.img.height * l.scale) / 2;
      if (Math.abs(pos.x - l.x) <= hw && Math.abs(pos.y - l.y) <= hh) {
        selectLayer(l.id);
        dragOffset = { x: pos.x - l.x, y: pos.y - l.y };
        return;
      }
    }
  } else if (mode === 'pin') {
    // 引っ張る場所を指定
    pinArea = { x: pos.x, y: pos.y, radius: pinRadius };
  } else if (mode === 'pull') {
    // 指定エリアがある場合は、その円の中をクリックした時のみ反応
    if (pinArea) {
      const distToPin = Math.hypot(pos.x - pinArea.x, pos.y - pinArea.y);
      if (distToPin > pinArea.radius) return;
    }

    const activeRadius = pinArea ? pinArea.radius : pinRadius;
    const centerX = pinArea ? pinArea.x : pos.x;
    const centerY = pinArea ? pinArea.y : pos.y;

    for (let p of points) {
      const dist = Math.hypot(p.ox - centerX, p.oy - centerY);
      if (dist < activeRadius) {
        p.grabbed = true;
        p.influence = Math.cos((dist / activeRadius) * (Math.PI / 2));
        p.startX = p.x;
        p.startY = p.y;
        p.dragStartX = pos.x;
        p.dragStartY = pos.y;
      }
    }
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!isDragging) return;
  const pos = getPos(e);

  if (mode === 'edit' && selectedLayerId) {
    const layer = layers.find(l => l.id === selectedLayerId);
    if (layer) {
      layer.x = pos.x - dragOffset.x;
      layer.y = pos.y - dragOffset.y;
      renderComposite();
    }
  } else if (mode === 'pin') {
    pinArea = { x: pos.x, y: pos.y, radius: pinRadius };
  } else if (mode === 'pull') {
    for (let p of points) {
      if (p.grabbed) {
        const moveX = pos.x - p.dragStartX;
        const moveY = pos.y - p.dragStartY;
        p.x = p.startX + moveX * p.influence;
        p.y = p.startY + moveY * p.influence;
        p.vx = 0;
        p.vy = 0;
      }
    }
  }
});

window.addEventListener('pointerup', () => {
  isDragging = false;
  for (let p of points) {
    p.grabbed = false;
  }
});

// 画像読み込みヘルパー
function handleImageFile(input, callback) {
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => callback(img, file.name);
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    input.value = '';
  });
}

// 1. ベース写真読み込み（比率自動調整）
handleImageFile(document.getElementById('bgImageInput'), (img) => {
  bgConfig.img = img;
  resizeWorkspace(img.width, img.height);
});

// 背景作成ボタン
document.getElementById('createBgBtn').addEventListener('click', () => {
  const aspect = document.getElementById('aspectSelect').value;
  const [aw, ah] = aspect.split(':').map(Number);
  bgConfig.img = null;
  bgConfig.type = document.getElementById('bgTypeSelect').value;
  bgConfig.color1 = document.getElementById('bgColor1').value;
  bgConfig.color2 = document.getElementById('bgColor2').value;
  resizeWorkspace(aw * 150, ah * 150);
});

// 2. 重ねる写真の追加
handleImageFile(document.getElementById('addLayerInput'), (img, name) => {
  const initialScale = Math.min((canvas.width * 0.5) / img.width, (canvas.height * 0.5) / img.height, 1);
  const newLayer = {
    id: Date.now(),
    name: name.slice(0, 12),
    img: img,
    x: canvas.width / 2,
    y: canvas.height / 2,
    scale: Number(initialScale.toFixed(2)),
    rotation: 0
  };
  layers.push(newLayer);
  updateLayerSelectUI();
  selectLayer(newLayer.id);
  renderComposite();
  switchMode('edit');
});

// レイヤーUI更新
function updateLayerSelectUI() {
  const select = document.getElementById('layerSelect');
  const controls = document.getElementById('layerControls');
  select.innerHTML = '';

  if (layers.length === 0) {
    controls.classList.add('hidden');
    selectedLayerId = null;
    return;
  }

  controls.classList.remove('hidden');
  layers.forEach((l, idx) => {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = `レイヤー${idx + 1}: ${l.name}`;
    select.appendChild(opt);
  });
}

function selectLayer(id) {
  selectedLayerId = Number(id);
  document.getElementById('layerSelect').value = selectedLayerId;
  const layer = layers.find(l => l.id === selectedLayerId);
  if (layer) {
    document.getElementById('layerScale').value = layer.scale;
    document.getElementById('layerRotate').value = layer.rotation;
  }
}

document.getElementById('layerSelect').addEventListener('change', (e) => {
  selectLayer(e.target.value);
});

document.getElementById('layerScale').addEventListener('input', (e) => {
  const layer = layers.find(l => l.id === selectedLayerId);
  if (layer) {
    layer.scale = Number(e.target.value);
    renderComposite();
  }
});

document.getElementById('layerRotate').addEventListener('input', (e) => {
  const layer = layers.find(l => l.id === selectedLayerId);
  if (layer) {
    layer.rotation = Number(e.target.value);
    renderComposite();
  }
});

// レイヤー順序変更・削除
document.getElementById('layerUpBtn').addEventListener('click', () => {
  const idx = layers.findIndex(l => l.id === selectedLayerId);
  if (idx >= 0 && idx < layers.length - 1) {
    [layers[idx], layers[idx + 1]] = [layers[idx + 1], layers[idx]];
    updateLayerSelectUI();
    selectLayer(selectedLayerId);
    renderComposite();
  }
});

document.getElementById('layerDownBtn').addEventListener('click', () => {
  const idx = layers.findIndex(l => l.id === selectedLayerId);
  if (idx > 0) {
    [layers[idx], layers[idx - 1]] = [layers[idx - 1], layers[idx]];
    updateLayerSelectUI();
    selectLayer(selectedLayerId);
    renderComposite();
  }
});

document.getElementById('layerDeleteBtn').addEventListener('click', () => {
  layers = layers.filter(l => l.id !== selectedLayerId);
  updateLayerSelectUI();
  if (layers.length > 0) selectLayer(layers[layers.length - 1].id);
  renderComposite();
});

// モード切り替え
function switchMode(newMode) {
  mode = newMode;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('pullOptions').classList.add('hidden');

  if (mode === 'edit') {
    document.getElementById('tabEdit').classList.add('active');
  } else if (mode === 'pin') {
    document.getElementById('tabPin').classList.add('active');
    document.getElementById('pullOptions').classList.remove('hidden');
  } else if (mode === 'pull') {
    document.getElementById('tabPull').classList.add('active');
    document.getElementById('pullOptions').classList.remove('hidden');
  }
}

document.getElementById('tabEdit').addEventListener('click', () => switchMode('edit'));
document.getElementById('tabPin').addEventListener('click', () => switchMode('pin'));
document.getElementById('tabPull').addEventListener('click', () => switchMode('pull'));

document.getElementById('pinRadiusSlider').addEventListener('input', (e) => {
  pinRadius = Number(e.target.value);
  if (pinArea) pinArea.radius = pinRadius;
});

document.getElementById('springSlider').addEventListener('input', (e) => {
  stiffness = Number(e.target.value);
});

document.getElementById('clearPinBtn').addEventListener('click', () => {
  pinArea = null;
});

// 保存ボタン（ガイド枠を消した状態で描画して保存）
document.getElementById('saveBtn').addEventListener('click', () => {
  animate(true);
  const link = document.createElement('a');
  link.download = 'composite-photo.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// 初期起動
resizeWorkspace(500, 500);
animate(false);
