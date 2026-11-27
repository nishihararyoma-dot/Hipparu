const viewport = document.getElementById('canvasViewport');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const offCanvas = document.createElement('canvas');
const offCtx = offCanvas.getContext('2d');

let docWidth = 800;
let docHeight = 800;

let view = {
  scale: 1,
  x: 0,
  y: 0
};

let mode = 'edit'; // 'edit' | 'pan' | 'pin' | 'pull' | 'crop'
let hideGuides = false;
let freezePull = false;
let syncPins = true;
let fingerRadius = 90;
let roundness = 0.75; // 円の塊感（高いほど円全体が丸ごと伸びる）

let bgConfig = { type: 'solid', color1: '#ffffff', color2: '#a2d2ff', img: null };
let layers = [];
let selectedLayerId = null;

let cropPoints = [];

let pinAreas = [];
let selectedPinId = null;

// 独立した「戻るスピード」と「揺れの回数」
let returnSpeed = 0.80; // 0.1〜1.0（速さ）
let bounceAmount = 0.25; // 0.0〜0.90（跳ね返り・揺れ残り）

const COLS = 28;
const ROWS = 28;
let points = [];
let isDeformed = false;

// 引っ張り中の視覚ガイド用
let activePullCircle = null; // { x, y, radius }

function syncViewportSize() {
  const rect = viewport.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}

function resetView() {
  syncViewportSize();
  const margin = 36;
  const scaleX = (canvas.width - margin * 2) / docWidth;
  const scaleY = (canvas.height - margin * 2) / docHeight;
  view.scale = Math.min(scaleX, scaleY);
  view.x = (canvas.width - docWidth * view.scale) / 2;
  view.y = (canvas.height - docHeight * view.scale) / 2;
  updateZoomLabel();
}

function updateZoomLabel() {
  const baseScale = Math.min((canvas.width - 72) / docWidth, (canvas.height - 72) / docHeight);
  const percent = Math.round((view.scale / baseScale) * 100);
  document.getElementById('zoomLabel').textContent = `${percent}%`;
}

function resizeWorkspace(width, height) {
  const targetMax = 800;
  let w = width;
  let h = height;

  if (w >= h) {
    h = Math.round((h / w) * targetMax);
    w = targetMax;
  } else {
    w = Math.round((w / h) * targetMax);
    h = targetMax;
  }

  docWidth = w;
  docHeight = h;
  offCanvas.width = docWidth;
  offCanvas.height = docHeight;

  pinAreas = [];
  selectedPinId = null;
  initMesh();
  renderComposite();
  resetView();
}

function initMesh() {
  points = [];
  for (let r = 0; r <= ROWS; r++) {
    for (let c = 0; c <= COLS; c++) {
      const x = (c / COLS) * docWidth;
      const y = (r / ROWS) * docHeight;
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
  isDeformed = false;
}

// 円の塊感を計算する関数（内側が丸ごとついてくるドームカーブ）
function calcCircleInfluence(dist, radius) {
  if (dist >= radius) return 0;
  const norm = dist / radius; // 0(中心) 〜 1(フチ)
  // roundnessが高いほど、中心付近が平らに1.0を保ち、フチ近くで滑らかに0へ落ちる
  const flatZone = roundness * 0.75;
  if (norm <= flatZone) {
    return 1.0;
  }
  const edgeNorm = (norm - flatZone) / (1.0 - flatZone);
  return 0.5 * (1 + Math.cos(edgeNorm * Math.PI));
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
  } else if (type === 'rainbow') {
    const grad = context.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#ff3b30');
    grad.addColorStop(0.17, '#ff9500');
    grad.addColorStop(0.34, '#ffcc00');
    grad.addColorStop(0.51, '#34c759');
    grad.addColorStop(0.68, '#00c7be');
    grad.addColorStop(0.85, '#007aff');
    grad.addColorStop(1, '#af52de');
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

function drawTexturedTriangle(targetCtx, p0, p1, p2) {
  const cx = (p0.x + p1.x + p2.x) / 3;
  const cy = (p0.y + p1.y + p2.y) / 3;

  function expand(p) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: p.x + (dx / len) * 0.75,
      y: p.y + (dy / len) * 0.75
    };
  }

  const ep0 = expand(p0);
  const ep1 = expand(p1);
  const ep2 = expand(p2);

  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.moveTo(ep0.x, ep0.y);
  targetCtx.lineTo(ep1.x, ep1.y);
  targetCtx.lineTo(ep2.x, ep2.y);
  targetCtx.closePath();
  targetCtx.clip();

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

    targetCtx.transform(a, b, c, d, e, f);
    targetCtx.drawImage(offCanvas, 0, 0);
  }
  targetCtx.restore();
}

function drawDeformedMesh(targetCtx) {
  const triangles = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i0 = r * (COLS + 1) + c;
      const i1 = i0 + 1;
      const i2 = (r + 1) * (COLS + 1) + c;
      const i3 = i2 + 1;

      const t1 = [points[i0], points[i1], points[i2]];
      const t2 = [points[i1], points[i3], points[i2]];

      const grabBonus1 = (t1[0].grabbed || t1[1].grabbed || t1[2].grabbed) ? 10000 : 0;
      const grabBonus2 = (t2[0].grabbed || t2[1].grabbed || t2[2].grabbed) ? 10000 : 0;

      const disp1 = Math.max(
        Math.hypot(t1[0].x - t1[0].ox, t1[0].y - t1[0].oy),
        Math.hypot(t1[1].x - t1[1].ox, t1[1].y - t1[1].oy),
        Math.hypot(t1[2].x - t1[2].ox, t1[2].y - t1[2].oy)
      ) + grabBonus1;

      const disp2 = Math.max(
        Math.hypot(t2[0].x - t2[0].ox, t2[0].y - t2[0].oy),
        Math.hypot(t2[1].x - t2[1].ox, t2[1].y - t2[1].oy),
        Math.hypot(t2[2].x - t2[2].ox, t2[2].y - t2[2].oy)
      ) + grabBonus2;

      triangles.push({ pts: t1, score: disp1 });
      triangles.push({ pts: t2, score: disp2 });
    }
  }

  triangles.sort((a, b) => a.score - b.score);

  for (let tri of triangles) {
    drawTexturedTriangle(targetCtx, tri.pts[0], tri.pts[1], tri.pts[2]);
  }
}

function renderFrame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 「戻るスピード」と「揺れの回数」を完全に独立させた物理演算
  if (isDeformed) {
    let anyDeformed = false;
    // returnSpeed (0.1〜1.0) から固有角振動数 omega を決定（最大で1〜2フレームで到達する超高速スナップ）
    const omega = 0.22 + returnSpeed * 1.15;
    // bounceAmount (0.0〜0.9) から減衰比 zeta を決定（0なら揺れゼロでピタッと止まり、0.9なら長く揺れる）
    const zeta = 1.0 - bounceAmount * 0.92;

    for (let p of points) {
      if (!p.grabbed && !freezePull) {
        const dx = p.ox - p.x;
        const dy = p.oy - p.y;

        // 減衰振動の正確な離散ステップ（スピードと揺れが干渉しない）
        const ax = omega * omega * dx - 2 * zeta * omega * p.vx;
        const ay = omega * omega * dy - 2 * zeta * omega * p.vy;

        p.vx += ax;
        p.vy += ay;
        p.x += p.vx;
        p.y += p.vy;

        // 振動がオーバーシュートして暴れないよう安全リミット
        if (Math.abs(p.ox - p.x) < 0.25 && Math.abs(p.oy - p.y) < 0.25 && Math.abs(p.vx) < 0.25 && Math.abs(p.vy) < 0.25) {
          p.x = p.ox;
          p.y = p.oy;
          p.vx = 0;
          p.vy = 0;
        } else {
          anyDeformed = true;
        }
      } else {
        if (Math.abs(p.ox - p.x) > 0.1 || Math.abs(p.oy - p.y) > 0.1 || p.grabbed) {
          anyDeformed = true;
        }
      }
    }
    if (!anyDeformed) {
      isDeformed = false;
    }
  }

  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);

  if (!isDeformed) {
    ctx.drawImage(offCanvas, 0, 0);
  } else {
    drawDeformedMesh(ctx);
  }

  if (mode === 'crop' && cropPoints.length > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cropPoints[0].x, cropPoints[0].y);
    for (let i = 1; i < cropPoints.length; i++) {
      ctx.lineTo(cropPoints[i].x, cropPoints[i].y);
    }
    ctx.closePath();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3 / view.scale;
    ctx.setLineDash([6 / view.scale, 4 / view.scale]);
    ctx.stroke();
    ctx.fillStyle = 'rgba(245, 158, 11, 0.25)';
    ctx.fill();
    ctx.restore();
  }

  if (!hideGuides) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 2 / view.scale;
    ctx.strokeRect(0, 0, docWidth, docHeight);

    if ((mode === 'edit' || mode === 'crop') && selectedLayerId) {
      const layer = layers.find(l => l.id === selectedLayerId);
      if (layer) {
        ctx.save();
        ctx.translate(layer.x, layer.y);
        ctx.rotate((layer.rotation * Math.PI) / 180);
        const lw = layer.img.width * layer.scale;
        const lh = layer.img.height * layer.scale;
        ctx.strokeStyle = mode === 'crop' ? '#f59e0b' : '#1877f2';
        ctx.lineWidth = 2.5 / view.scale;
        ctx.setLineDash([8 / view.scale, 8 / view.scale]);
        ctx.strokeRect(-lw / 2, -lh / 2, lw, lh);
        ctx.restore();
      }
    }

    // 範囲指定モード、または引っ張りモードでも赤い円を薄く表示して掴みやすくする
    if ((mode === 'pin' || mode === 'pull') && pinAreas.length > 0) {
      pinAreas.forEach((pin, index) => {
        const isSelected = pin.id === selectedPinId;
        ctx.save();
        ctx.beginPath();
        ctx.arc(pin.x, pin.y, pin.radius, 0, Math.PI * 2);
        ctx.strokeStyle = mode === 'pin'
          ? (isSelected ? 'rgba(228, 30, 63, 1.0)' : 'rgba(228, 30, 63, 0.55)')
          : 'rgba(228, 30, 63, 0.35)';
        ctx.lineWidth = (isSelected && mode === 'pin' ? 3.5 : 2) / view.scale;
        ctx.setLineDash([8 / view.scale, 6 / view.scale]);
        ctx.stroke();
        if (mode === 'pin') {
          ctx.fillStyle = isSelected ? 'rgba(228, 30, 63, 0.2)' : 'rgba(228, 30, 63, 0.08)';
          ctx.fill();
          ctx.fillStyle = '#e41e3f';
          ctx.font = `bold ${Math.round(16 / view.scale)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(index + 1), pin.x, pin.y);
        }
        ctx.restore();
      });
    }

    // 引っ張っている最中の「掴んでいる円」の視覚ガイド
    if (mode === 'pull' && activePullCircle) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(activePullCircle.x, activePullCircle.y, activePullCircle.radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(24, 119, 242, 0.75)';
      ctx.lineWidth = 2.5 / view.scale;
      ctx.stroke();
      ctx.fillStyle = 'rgba(24, 119, 242, 0.12)';
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.restore();
}

function animate() {
  renderFrame();
  requestAnimationFrame(animate);
}

function screenToDoc(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  return {
    x: (sx - view.x) / view.scale,
    y: (sy - view.y) / view.scale,
    sx: sx,
    sy: sy
  };
}

function applyFreehandCrop(layer, docPoints) {
  if (docPoints.length < 3) return;

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = layer.img.width;
  cropCanvas.height = layer.img.height;
  const cCtx = cropCanvas.getContext('2d');

  const rad = (-layer.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  cCtx.save();
  cCtx.beginPath();
  docPoints.forEach((pt, idx) => {
    const dx = pt.x - layer.x;
    const dy = pt.y - layer.y;
    const rx = (dx * cos - dy * sin) / layer.scale + layer.img.width / 2;
    const ry = (dx * sin + dy * cos) / layer.scale + layer.img.height / 2;
    if (idx === 0) cCtx.moveTo(rx, ry);
    else cCtx.lineTo(rx, ry);
  });
  cCtx.closePath();
  cCtx.clip();
  cCtx.drawImage(layer.img, 0, 0);
  cCtx.restore();

  const croppedImg = new Image();
  croppedImg.onload = () => {
    layer.img = croppedImg;
    renderComposite();
    exitCropMode();
  };
  croppedImg.src = cropCanvas.toDataURL('image/png');
}

function exitCropMode() {
  cropPoints = [];
  document.getElementById('cropNoticePanel').classList.add('hidden');
  switchMode('edit');
}

let activePointers = new Map();
let lastPinchDist = null;
let lastPinchCenter = null;
let singleAction = null;
let dragOffset = { x: 0, y: 0 };
let pullDragStart = { x: 0, y: 0 };
let pullCircleOrigin = { x: 0, y: 0 };

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size >= 2) {
    singleAction = null;
    activePullCircle = null;
    for (let p of points) p.grabbed = false;
    const pts = Array.from(activePointers.values());
    lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const rect = canvas.getBoundingClientRect();
    lastPinchCenter = {
      x: ((pts[0].x + pts[1].x) / 2) - rect.left,
      y: ((pts[0].y + pts[1].y) / 2) - rect.top
    };
    return;
  }

  const pos = screenToDoc(e.clientX, e.clientY);

  if (mode === 'crop') {
    singleAction = 'crop';
    cropPoints = [{ x: pos.x, y: pos.y }];
    return;
  }

  if (mode === 'pan') {
    singleAction = 'pan';
    dragOffset = { x: pos.sx - view.x, y: pos.sy - view.y };
    return;
  }

  if (mode === 'edit') {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      const hw = (l.img.width * l.scale) / 2;
      const hh = (l.img.height * l.scale) / 2;
      if (Math.abs(pos.x - l.x) <= hw && Math.abs(pos.y - l.y) <= hh) {
        selectLayer(l.id);
        singleAction = 'layer';
        dragOffset = { x: pos.x - l.x, y: pos.y - l.y };
        return;
      }
    }
    singleAction = 'pan';
    dragOffset = { x: pos.sx - view.x, y: pos.sy - view.y };

  } else if (mode === 'pin') {
    singleAction = 'pin';
    for (let i = pinAreas.length - 1; i >= 0; i--) {
      const pin = pinAreas[i];
      if (Math.hypot(pos.x - pin.x, pos.y - pin.y) <= pin.radius) {
        selectedPinId = pin.id;
        document.getElementById('pinRadiusSlider').value = pin.radius;
        dragOffset = { x: pos.x - pin.x, y: pos.y - pin.y };
        return;
      }
    }

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
    singleAction = 'pull';
    pullDragStart = { x: pos.x, y: pos.y };

    if (pinAreas.length > 0) {
      let hitPin = null;
      for (let i = pinAreas.length - 1; i >= 0; i--) {
        if (Math.hypot(pos.x - pinAreas[i].x, pos.y - pinAreas[i].y) <= pinAreas[i].radius) {
          hitPin = pinAreas[i];
          break;
        }
      }

      if (!hitPin) {
        singleAction = 'pan';
        dragOffset = { x: pos.sx - view.x, y: pos.sy - view.y };
        return;
      }

      isDeformed = true;
      const targetPins = syncPins ? pinAreas : [hitPin];
      pullCircleOrigin = { x: hitPin.x, y: hitPin.y };
      activePullCircle = { x: hitPin.x, y: hitPin.y, radius: hitPin.radius };

      for (let p of points) {
        let maxInf = 0;
        for (let pin of targetPins) {
          // すでに変形している頂点(p.x, p.y)と元の座標(p.ox, p.oy)の近い方で判定し、丸ごと掴む
          const distOrig = Math.hypot(p.ox - pin.x, p.oy - pin.y);
          const distCurr = Math.hypot(p.x - pin.x, p.y - pin.y);
          const dist = Math.min(distOrig, distCurr);
          const inf = calcCircleInfluence(dist, pin.radius);
          if (inf > maxInf) maxInf = inf;
        }
        if (maxInf > 0) {
          p.grabbed = true;
          p.influence = maxInf;
          p.startX = p.x;
          p.startY = p.y;
        }
      }
    } else {
      isDeformed = true;
      pullCircleOrigin = { x: pos.x, y: pos.y };
      activePullCircle = { x: pos.x, y: pos.y, radius: fingerRadius };

      for (let p of points) {
        const distOrig = Math.hypot(p.ox - pos.x, p.oy - pos.y);
        const distCurr = Math.hypot(p.x - pos.x, p.y - pos.y);
        const dist = Math.min(distOrig, distCurr);
        const inf = calcCircleInfluence(dist, fingerRadius);
        if (inf > 0) {
          p.grabbed = true;
          p.influence = inf;
          p.startX = p.x;
          p.startY = p.y;
        }
      }
    }
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size >= 2) {
    const pts = Array.from(activePointers.values());
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const rect = canvas.getBoundingClientRect();
    const center = {
      x: ((pts[0].x + pts[1].x) / 2) - rect.left,
      y: ((pts[0].y + pts[1].y) / 2) - rect.top
    };

    if (lastPinchDist && lastPinchCenter) {
      const zoomFactor = dist / lastPinchDist;
      const newScale = Math.min(Math.max(view.scale * zoomFactor, 0.2), 5.0);
      const actualFactor = newScale / view.scale;

      view.x = center.x - (center.x - view.x) * actualFactor + (center.x - lastPinchCenter.x);
      view.y = center.y - (center.y - view.y) * actualFactor + (center.y - lastPinchCenter.y);
      view.scale = newScale;
      updateZoomLabel();
    }

    lastPinchDist = dist;
    lastPinchCenter = center;
    return;
  }

  const pos = screenToDoc(e.clientX, e.clientY);

  if (singleAction === 'crop') {
    cropPoints.push({ x: pos.x, y: pos.y });
  } else if (singleAction === 'pan') {
    view.x = pos.sx - dragOffset.x;
    view.y = pos.sy - dragOffset.y;
  } else if (singleAction === 'layer' && selectedLayerId) {
    const layer = layers.find(l => l.id === selectedLayerId);
    if (layer) {
      layer.x = pos.x - dragOffset.x;
      layer.y = pos.y - dragOffset.y;
      renderComposite();
    }
  } else if (singleAction === 'pin' && selectedPinId) {
    const pin = pinAreas.find(p => p.id === selectedPinId);
    if (pin) {
      pin.x = pos.x - dragOffset.x;
      pin.y = pos.y - dragOffset.y;
    }
  } else if (singleAction === 'pull') {
    const moveX = pos.x - pullDragStart.x;
    const moveY = pos.y - pullDragStart.y;
    if (activePullCircle) {
      activePullCircle.x = pullCircleOrigin.x + moveX;
      activePullCircle.y = pullCircleOrigin.y + moveY;
    }
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

function handlePointerEnd(e) {
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) {
    lastPinchDist = null;
    lastPinchCenter = null;
  }
  if (activePointers.size === 0) {
    if (singleAction === 'crop' && selectedLayerId) {
      const layer = layers.find(l => l.id === selectedLayerId);
      if (layer && cropPoints.length > 5) {
        applyFreehandCrop(layer, cropPoints);
      } else {
        exitCropMode();
      }
    }
    singleAction = null;
    activePullCircle = null;
    for (let p of points) {
      p.grabbed = false;
    }
  }
}

canvas.addEventListener('pointerup', handlePointerEnd);
canvas.addEventListener('pointercancel', handlePointerEnd);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
  const newScale = Math.min(Math.max(view.scale * zoomFactor, 0.2), 5.0);
  const actualFactor = newScale / view.scale;

  view.x = mx - (mx - view.x) * actualFactor;
  view.y = my - (my - view.y) * actualFactor;
  view.scale = newScale;
  updateZoomLabel();
}, { passive: false });

document.getElementById('resetViewBtn').addEventListener('click', resetView);

function loadBlobAsResizedImage(blob, callback) {
  if (!blob) return;

  const url = URL.createObjectURL(blob);
  const rawImg = new Image();
  rawImg.onload = () => {
    const maxLoadSize = 900;
    let w = rawImg.width;
    let h = rawImg.height;

    if (w > maxLoadSize || h > maxLoadSize) {
      if (w >= h) {
        h = Math.round((h / w) * maxLoadSize);
        w = maxLoadSize;
      } else {
        w = Math.round((w / h) * maxLoadSize);
        h = maxLoadSize;
      }
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(rawImg, 0, 0, w, h);
    URL.revokeObjectURL(url);

    const img = new Image();
    img.onload = () => {
      callback(img);
    };
    img.onerror = () => {
      alert('画像の変換に失敗しました。');
    };
    img.src = tempCanvas.toDataURL('image/png');
  };
  rawImg.onerror = () => {
    URL.revokeObjectURL(url);
    alert('画像の読み込みに失敗しました。');
  };
  rawImg.src = url;
}

function addImageLayer(img, nameText) {
  const initialScale = Math.min((docWidth * 0.45) / img.width, (docHeight * 0.45) / img.height, 1.5);
  const newLayer = {
    id: Date.now() + Math.random(),
    name: nameText,
    img: img,
    originalImg: img,
    x: docWidth / 2,
    y: docHeight / 2,
    scale: Number(initialScale.toFixed(2)),
    rotation: 0
  };
  layers.push(newLayer);
  updateLayerSelectUI();
  selectLayer(newLayer.id);
  renderComposite();
  switchMode('edit');
}

const bgImageInput = document.getElementById('bgImageInput');
bgImageInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  loadBlobAsResizedImage(file, (img) => {
    bgConfig.img = img;
    resizeWorkspace(img.width, img.height);
    bgImageInput.value = '';
  });
});

const addLayerInput = document.getElementById('addLayerInput');
addLayerInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const labelName = file.name ? file.name.slice(0, 12) : '写真';
  loadBlobAsResizedImage(file, (img) => {
    addImageLayer(img, labelName);
    addLayerInput.value = '';
  });
});

document.getElementById('pasteImgBtn').addEventListener('click', async () => {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find(type => type.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        loadBlobAsResizedImage(blob, (img) => {
          addImageLayer(img, '貼付画像');
        });
        return;
      }
    }
    alert('クリップボードに画像がありません。写真アプリで画像をコピーしてから押してください。');
  } catch (err) {
    alert('画面の何もない場所を長押しして「ペースト」を選んでください。');
  }
});

window.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      const blob = items[i].getAsFile();
      loadBlobAsResizedImage(blob, (img) => {
        addImageLayer(img, '貼付画像');
      });
      break;
    }
  }
});

document.getElementById('addTextBtn').addEventListener('click', () => {
  const input = document.getElementById('textInput');
  const text = input.value.trim();
  if (!text) return;

  const color = document.getElementById('textColor').value;
  const isRainbow = document.getElementById('textRainbowCheck').checked;

  const tCanvas = document.createElement('canvas');
  const tCtx = tCanvas.getContext('2d');
  const fontSize = 80;
  tCtx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  const metrics = tCtx.measureText(text);

  tCanvas.width = Math.ceil(metrics.width) + 40;
  tCanvas.height = fontSize + 40;

  tCtx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  tCtx.textAlign = 'center';
  tCtx.textBaseline = 'middle';

  if (isRainbow) {
    const grad = tCtx.createLinearGradient(20, 0, tCanvas.width - 20, 0);
    grad.addColorStop(0, '#ff3b30');
    grad.addColorStop(0.17, '#ff9500');
    grad.addColorStop(0.34, '#ffcc00');
    grad.addColorStop(0.51, '#34c759');
    grad.addColorStop(0.68, '#00c7be');
    grad.addColorStop(0.85, '#007aff');
    grad.addColorStop(1, '#af52de');
    tCtx.fillStyle = grad;
  } else {
    tCtx.fillStyle = color;
  }

  tCtx.fillText(text, tCanvas.width / 2, tCanvas.height / 2);

  const img = new Image();
  img.onload = () => {
    addImageLayer(img, `文字:${text.slice(0, 8)}`);
    input.value = '';
  };
  img.src = tCanvas.toDataURL('image/png');
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

document.getElementById('cropModeBtn').addEventListener('click', () => {
  if (!selectedLayerId) return;
  mode = 'crop';
  cropPoints = [];
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('pullOptions').classList.add('hidden');
  document.getElementById('cropNoticePanel').classList.remove('hidden');
});

document.getElementById('cancelCropBtn').addEventListener('click', exitCropMode);

document.getElementById('resetCropBtn').addEventListener('click', () => {
  const layer = layers.find(l => l.id === selectedLayerId);
  if (layer && layer.originalImg) {
    layer.img = layer.originalImg;
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
  document.getElementById('cropNoticePanel').classList.add('hidden');

  if (mode === 'edit') {
    document.getElementById('tabEdit').classList.add('active');
  } else if (mode === 'pan') {
    document.getElementById('tabPan').classList.add('active');
  } else if (mode === 'pin') {
    document.getElementById('tabPin').classList.add('active');
    document.getElementById('pullOptions').classList.remove('hidden');
  } else if (mode === 'pull') {
    document.getElementById('tabPull').classList.add('active');
    document.getElementById('pullOptions').classList.remove('hidden');
  }
}

document.getElementById('tabEdit').addEventListener('click', () => switchMode('edit'));
document.getElementById('tabPan').addEventListener('click', () => switchMode('pan'));
document.getElementById('tabPin').addEventListener('click', () => switchMode('pin'));
document.getElementById('tabPull').addEventListener('click', () => switchMode('pull'));

document.getElementById('hideGuidesCheck').addEventListener('change', (e) => {
  hideGuides = e.target.checked;
});

document.getElementById('freezePullCheck').addEventListener('change', (e) => {
  freezePull = e.target.checked;
});

document.getElementById('syncPinsCheck').addEventListener('change', (e) => {
  syncPins = e.target.checked;
});

document.getElementById('roundnessSlider').addEventListener('input', (e) => {
  roundness = Number(e.target.value);
});

document.getElementById('fingerRadiusSlider').addEventListener('input', (e) => {
  fingerRadius = Number(e.target.value);
});

document.getElementById('pinRadiusSlider').addEventListener('input', (e) => {
  const newRadius = Number(e.target.value);
  if (selectedPinId) {
    const pin = pinAreas.find(p => p.id === selectedPinId);
    if (pin) pin.radius = newRadius;
  }
});

const springSlider = document.getElementById('springSlider');
const bounceSlider = document.getElementById('bounceSlider');

springSlider.addEventListener('input', (e) => {
  returnSpeed = Number(e.target.value);
});

bounceSlider.addEventListener('input', (e) => {
  bounceAmount = Number(e.target.value);
});

document.getElementById('presetRubberBtn').addEventListener('click', () => {
  returnSpeed = 0.85;
  bounceAmount = 0.25;
  springSlider.value = returnSpeed;
  bounceSlider.value = bounceAmount;
});

document.getElementById('presetSlimeBtn').addEventListener('click', () => {
  returnSpeed = 0.20;
  bounceAmount = 0.80;
  springSlider.value = returnSpeed;
  bounceSlider.value = bounceAmount;
});

document.getElementById('resetDeformBtn').addEventListener('click', () => {
  initMesh();
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
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = docWidth;
  exportCanvas.height = docHeight;
  const exportCtx = exportCanvas.getContext('2d');

  if (!isDeformed) {
    exportCtx.drawImage(offCanvas, 0, 0);
  } else {
    drawDeformedMesh(exportCtx);
  }

  exportCanvas.toBlob((blob) => {
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

viewport.addEventListener('dragover', (e) => {
  e.preventDefault();
  viewport.style.outline = '4px dashed #1877f2';
});

viewport.addEventListener('dragleave', () => {
  viewport.style.outline = 'none';
});

viewport.addEventListener('drop', (e) => {
  e.preventDefault();
  viewport.style.outline = 'none';
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length > 0) {
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.startsWith('image/')) {
        loadBlobAsResizedImage(files[i], (img) => {
          addImageLayer(img, files[i].name.slice(0, 12) || 'ドロップ画像');
        });
      }
    }
  }
});

window.addEventListener('resize', () => {
  resetView();
});

// 初期起動
resizeWorkspace(800, 800);
animate();
