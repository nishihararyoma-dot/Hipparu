const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const offCanvas = document.createElement('canvas');
const offCtx = offCanvas.getContext('2d');

// アプリの状態
let mode = 'edit'; // 'edit' | 'pin' | 'pull'
let hideGuides = false;
let bgConfig = { type: 'solid', color1: '#ffffff', color2: '#a2d2ff', img: null };
let layers = [];
let selectedLayerId = null;

// 引っ張り用
let pinArea = null;
let pinRadius = 80;
let stiffness = 0.16;
const damping = 0.82;
const COLS = 28;
const ROWS = 28;
let points = [];

function resizeWorkspace(width, height) {
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

function renderComposite() {
  const w = offCanvas.width;
  const h = offCanvas.height;
  offCtx.clearRect(0, 0, w, h);

  if (bgConfig.img) {
    offCtx.drawImage(bgConfig.img, 0, 0, w, h);
  } else {
    drawGeneratedBackground(offCtx, w, h);
  }

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

function renderFrame(isSaving = false) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

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

  // 保存時ではなく、かつガイド線非表示がオフの場合のみ線を描画
  if (!isSaving && !hideGuides) {
    // 編集モード時の選択レイヤー枠
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

    // 「引っ張る場所を指定(pin)」モードの時だけ赤い円を表示（「引っ張る(pull)」時は透明になる）
    if (mode === 'pin' && pinArea) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(pinArea.x, pinArea.y, pinArea.radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(228, 30, 63, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.fillStyle = 'rgba(228, 30, 63, 0.12)';
      ctx.fill();
      ctx.restore();
    }
  }
}

function animate() {
  renderFrame(false);
  requestAnimationFrame(animate);
}

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
    pinArea = { x: pos.x, y: pos.y, radius: pinRadius };
  } else if (mode === 'pull') {
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

// 確実にファイル選択ダイアログを開くボタン連携
const bgImageInput = document.getElementById('bgImageInput');
document.getElementById('bgImageBtn').addEventListener('click', () => {
  bgImageInput.value = '';
  bgImageInput.click();
});

bgImageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    bgConfig.img = img;
    resizeWorkspace(img.width, img.height);
    URL.revokeObjectURL(url);
  };
  img.src = url;
});

const addLayerInput = document.getElementById('addLayerInput');
document.getElementById('addLayerBtn').addEventListener('click', () => {
  addLayerInput.value = '';
  addLayerInput.click();
});

addLayerInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;

  files.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const initialScale = Math.min((canvas.width * 0.5) / img.width, (canvas.height * 0.5) / img.height, 1);
      const newLayer = {
        id: Date.now() + index,
        name: file.name.slice(0, 12),
        img: img,
        x: canvas.width / 2 + (index * 15),
        y: canvas.height / 2 + (index * 15),
        scale: Number(initialScale.toFixed(2)),
        rotation: 0
      };
      layers.push(newLayer);
      updateLayerSelectUI();
      selectLayer(newLayer.id);
      renderComposite();
      switchMode('edit');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
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

// ガイド線非表示トグル
document.getElementById('hideGuidesCheck').addEventListener('change', (e) => {
  hideGuides = e.target.checked;
});

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

// 確実な画像ダウンロード処理（Blob生成）
document.getElementById('saveBtn').addEventListener('click', () => {
  renderFrame(true); // ガイド線を消した状態で描画
  canvas.toBlob((blob) => {
    if (!blob) {
      alert('画像の生成に失敗しました。');
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `edited-photo-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
});

// 初期起動
resizeWorkspace(500, 500);
animate();
