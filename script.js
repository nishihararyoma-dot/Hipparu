const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const offCanvas = document.createElement('canvas');
offCanvas.width = canvas.width;
offCanvas.height = canvas.height;
const offCtx = offCanvas.getContext('2d');

let bgImg = null;
let fgImg = null;
let fgPos = { x: 200, y: 200, scale: 0.5 };

let mode = 'pull';
let radius = 100;
let stiffness = 0.15;
const damping = 0.82;

const COLS = 24;
const ROWS = 24;
let points = [];

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

function updateCompositeImage() {
  offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);

  if (!bgImg) {
    offCtx.fillStyle = '#e0e7ff';
    offCtx.fillRect(0, 0, offCanvas.width, offCanvas.height);
    offCtx.fillStyle = '#94a3b8';
    offCtx.font = '16px sans-serif';
    offCtx.textAlign = 'center';
    offCtx.fillText('写真を選んで画面を引っ張ってみよう', 200, 200);
  } else {
    offCtx.drawImage(bgImg, 0, 0, offCanvas.width, offCanvas.height);
  }

  if (fgImg) {
    const w = fgImg.width * fgPos.scale;
    const h = fgImg.height * fgPos.scale;
    offCtx.drawImage(fgImg, fgPos.x - w / 2, fgPos.y - h / 2, w, h);
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

function animate() {
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

canvas.addEventListener('pointerdown', (e) => {
  isDragging = true;
  const pos = getPos(e);

  if (mode === 'pull') {
    for (let p of points) {
      const dx = p.x - pos.x;
      const dy = p.y - pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist < radius) {
        p.grabbed = true;
        p.influence = Math.cos((dist / radius) * (Math.PI / 2));
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

  if (mode === 'pull') {
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
  } else if (mode === 'move') {
    fgPos.x = pos.x;
    fgPos.y = pos.y;
    updateCompositeImage();
  }
});

window.addEventListener('pointerup', () => {
  isDragging = false;
  for (let p of points) {
    p.grabbed = false;
  }
});

function loadImage(input, callback) {
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => callback(img);
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

loadImage(document.getElementById('bgInput'), (img) => {
  bgImg = img;
  updateCompositeImage();
});

loadImage(document.getElementById('fgInput'), (img) => {
  fgImg = img;
  updateCompositeImage();
});

document.getElementById('modePull').addEventListener('click', (e) => {
  mode = 'pull';
  e.target.classList.add('active');
  document.getElementById('modeMove').classList.remove('active');
});

document.getElementById('modeMove').addEventListener('click', (e) => {
  mode = 'move';
  e.target.classList.add('active');
  document.getElementById('modePull').classList.remove('active');
});

document.getElementById('scaleSlider').addEventListener('input', (e) => {
  fgPos.scale = Number(e.target.value);
  updateCompositeImage();
});

document.getElementById('radiusSlider').addEventListener('input', (e) => {
  radius = Number(e.target.value);
});

document.getElementById('springSlider').addEventListener('input', (e) => {
  stiffness = Number(e.target.value);
});

document.getElementById('saveBtn').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'edited-photo.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

initMesh();
updateCompositeImage();
animate();
