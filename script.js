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

// 引っ張り用（複数の赤い円を配列で管理）
let pinAreas = []; // [{ id, x, y, radius }, ...]
let selectedPinId = null;
let pinRadius = 60;
let stiffness = 0.16;
const damping = 0.82;
const COLS = 32;
const ROWS = 32;
let points = [];

function resizeWorkspace(width, height) {
  const targetMax = 900;
  let w = width;
  let h = height;

  if (w >= h) {
    h = Math.round((h / w) * targetMax);
    w = targetMax;
  } else {
    w = Math.round((w / h) * targetMax);
    h = targetMax;
  }

  canvas.width = w;
  canvas.height = h;
  offCanvas.width = w;
  offCanvas.height = h;
  pinAreas = [];
  selectedPinId = null;
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
        grabbed: false,
        influence: 0,
        startX: x,
        startY: y
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
    const step = 36;
    for (let y = 18; y < h; y += step) {
      for (let x = 18; x < w; x += step) {
        context.beginPath();
        context.arc(x, y, 7, 0, Math.PI * 2);
        context.fill();
      }
    }
  } else if (type === 'check') {
    const size = 45;
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
  const cx = (p0.x + p1.x + p2.x) / 3;
  const cy = (p0.y + p1.y + p2.y) / 3;

  function expand(p) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: p.x + (dx / len) * 0.7,
      y: p.y + (dy / len) * 0.7
    };
  }

  const ep0 = expand(p0);
  const ep1 = expand(p1);
  const ep2 = expand(p2);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(ep0.x, ep0.y);
  ctx.lineTo(ep1.x, ep1.y);
  ctx.lineTo(ep2.x, ep2.y);
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

  // 伸びている（変位が大きい）三角形ほど手前に描画
  const triangles = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i0 = r * (COLS + 1) + c;
      const i1 = i0 + 1;
      const i2 = (r + 1) * (COLS + 1) + c;
      const i3 = i2 + 1;

      const t1 = [points[i0], points[i1], points[i2]];
      const t2 = [points[i1], points[i3], points[i2]];

      const disp1 = Math.hypot(t1[0].x - t1[0].ox, t1[0].y - t1[0].oy) +
                    Math.hypot(t1[1].x - t1[1].ox, t1[1].y - t1[1].oy) +
                    Math.hypot(t1[2].x - t1[2].ox, t1[2].y - t1[2].oy);

      const disp2 = Math.hypot(t2[0].x - t2[0].ox, t2[0].y - t2[0].oy) +
                    Math.hypot(t2[1].x - t2[1].ox, t2[1].y - t2[1].oy) +
                    Math.hypot(t2[2].x - t2[2].ox, t2[2].y - t2[2].oy);

      triangles.push({ pts: t1, disp: disp1 });
      triangles.push({ pts: t2, disp: disp2 });
    }
  }

  triangles.sort((a, b) => a.disp - b.disp);

  for (let tri of triangles) {
    drawTexturedTriangle(tri.pts[0], tri.pts[1], tri.pts[2]);
  }

  // 保存時ではなく、かつガイド線非表示がオフの場合のみ線を描画
  if (!isSaving && !hideGuides) {
    if (mode === 'edit' && selectedLayerId) {
      const layer = layers.find(l => l.id === selectedLayerId);
      if (layer) {
        ctx.save();
        ctx.translate(layer.x, layer.y);
        ctx.rotate((layer.rotation * Math.PI) / 180);
        const lw = layer.img.width * layer.scale;
        const lh = layer.img.height * layer.scale;
        ctx.strokeStyle = '#1877f2';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 8]);
        ctx.strokeRect(-lw / 2, -lh / 2, lw, lh);
        ctx.restore();
      }
    }

    // 「引っ張る場所を指定(pin)」モードの時だけ、配置されたすべての赤い円を表示
    if (mode === 'pin' && pinAreas.length > 0) {
      pinAreas.forEach((pin, index) => {
        const isSelected = pin.id === selectedPinId;
        ctx.save();
        ctx.beginPath();
        ctx.arc(pin.x, pin.y, pin.radius, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected ? 'rgba(228, 30, 63, 1.0)' : 'rgba(228, 30, 63, 0.55)';
        ctx.lineWidth = isSelected ? 4 : 2.5;
        ctx.setLineDash([8, 6]);
        ctx.stroke();
        ctx.fillStyle = isSelected ? 'rgba(228, 30, 63, 0.2)' : 'rgba(228, 30, 63, 0.08)';
        ctx.fill();

        // 番号ラベル
        ctx.fillStyle = '#e41e3f';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(index + 1), pin.x, pin.y);
        ctx.restore();
      });
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
let pullDragStart = { x: 0, y: 0 };

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
    // すでに置いてある赤い円の中をタップした場合は、その円を選択して移動モードにする
    for (let i = pinAreas.length - 1; i >= 0; i--) {
      const pin = pinAreas[i];
      if (Math.hypot(pos.x - pin.x, pos.y - pin.y) <= pin.radius) {
        selectedPinId = pin.id;
        document.getElementById('pinRadiusSlider').value = pin.radius;
        dragOffset = { x: pos.x - pin.x, y: pos.y - pin.y };
        return;
      }
    }

    // 何もない場所をタップした場合は、新しい赤い円を追加する
    const newPin = {
      id: Date.now() + Math.random(),
      x: pos.x,
      y: pos.y,
      radius: Number(document.getElementById('pinRadiusSlider').value)
    };
    pinAreas.push(newPin);
    selectedPinId = newPin.id;
    dragOffset = { x: 0, y: 0 };

  } else if (mode === 'pull') {
    pullDragStart = { x: pos.x, y: pos.y };

    if (pinAreas.length > 0) {
      // 置かれている赤い円のどれか1つでもタップされたか判定
      const hitAnyPin = pinAreas.some(pin => Math.hypot(pos.x - pin.x, pos.y - pin.y) <= pin.radius);
      if (!hitAnyPin) return;

      // すべての赤い円の中にあるメッシュ頂点を同時に掴む
      for (let p of points) {
        let maxInf = 0;
        for (let pin of pinAreas) {
          const dist = Math.hypot(p.ox - pin.x, p.oy - pin.y);
          if (dist < pin.radius) {
            const inf = Math.cos((dist / pin.radius) * (Math.PI / 2));
            if (inf > maxInf) maxInf = inf;
          }
        }
        if (maxInf > 0) {
          p.grabbed = true;
          p.influence = maxInf;
          p.startX = p.x;
          p.startY = p.y;
        }
      }
    } else {
      // 指定円が1つもない場合はタッチした場所の周囲を引っ張る
      const activeRadius = Number(document.getElementById('pinRadiusSlider').value);
      for (let p of points) {
        const dist = Math.hypot(p.ox - pos.x, p.oy - pos.y);
        if (dist < activeRadius) {
          p.grabbed = true;
          p.influence = Math.cos((dist / activeRadius) * (Math.PI / 2));
          p.startX = p.x;
          p.startY = p.y;
        }
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
  } else if (mode === 'pin' && selectedPinId) {
    const pin = pinAreas.find(p => p.id === selectedPinId);
    if (pin) {
      pin.x = pos.x - dragOffset.x;
      pin.y = pos.y - dragOffset.y;
    }
  } else if (mode === 'pull') {
    const moveX = pos.x - pullDragStart.x;
    const moveY = pos.y - pullDragStart.y;
    for (let p of points) {
      if (p.grabbed) {
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

// ファイル読み込み
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
      const initialScale = Math.min((canvas.width * 0.45) / img.width, (canvas.height * 0.45) / img.height, 1.5);
      const newLayer = {
        id: Date.now() + index,
        name: file.name.slice(0, 12),
        img: img,
        x: canvas.width / 2 + (index * 20),
        y: canvas.height / 2 + (index * 20),
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

document.getElementById('createBgBtn').addEventListener('click', () => {
  const aspect = document.getElementById('aspectSelect').value;
  const [aw, ah] = aspect.split(':').map(Number);
  bgConfig.img = null;
  bgConfig.type = document.getElementById('bgTypeSelect').value;
  bgConfig.color1 = document.getElementById('bgColor1').value;
  bgConfig.color2 = document.getElementById('bgColor2').value;
  resizeWorkspace(aw * 200, ah * 200);
});

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

document.getElementById('hideGuidesCheck').addEventListener('change', (e) => {
  hideGuides = e.target.checked;
});

document.getElementById('pinRadiusSlider').addEventListener('input', (e) => {
  const newRadius = Number(e.target.value);
  if (selectedPinId) {
    const pin = pinAreas.find(p => p.id === selectedPinId);
    if (pin) pin.radius = newRadius;
  }
});

document.getElementById('springSlider').addEventListener('input', (e) => {
  stiffness = Number(e.target.value);
});

document.getElementById('deleteOnePinBtn').addEventListener('click', () => {
  if (selectedPinId) {
    pinAreas = pinAreas.filter(p => p.id !== selectedPinId);
    selectedPinId = pinAreas.length > 0 ? pinAreas[pinAreas.length - 1].id : null;
  }
});

document.getElementById('clearPinBtn').addEventListener('click', () => {
  pinAreas = [];
  selectedPinId = null;
});

document.getElementById('saveBtn').addEventListener('click', () => {
  renderFrame(true);
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
resizeWorkspace(800, 800);
animate();
