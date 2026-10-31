// LED "next stop" board for the hero. Every destination in data-stops is rasterised in Inter Display
// to a grid of diodes, painted from pre-rendered sprites and rolled to the next stop like a bus sign.
//
// Contract: each [data-led-sign][data-stops="First|Second|…"] gets a
// <canvas class="led-sign-canvas" aria-hidden="true"> and data-led-ready after its first paint.
// CSS owns the frame and places the canvas over the element's content box; this module gives the
// canvas that box's size. Without stops, a 2D context or ResizeObserver, or after any error, the
// element keeps its fallback text.

const FONT = '"Inter Display", "Inter", system-ui, sans-serif';
const FONT_PROBE = '800 64px "Inter Display"';
const FONT_TIMEOUT = 1500; // ms to wait for the webfont before rasterising with whatever is available
const HOLD_FIRST = 4000; // ms the first stop stays up
const HOLD = 2600; // ms every other stop stays up
const ROLL = 450; // ms for the row roll between stops
const RESUME_MIN = 1000; // ms a stop stays up after the board pauses and resumes
const RESIZE_DELAY = 150; // ms

// Diode pitch in CSS px: 7.5 on boards at least 900px wide, easing down to 4.6 at 420px and below.
const PITCH = { narrow: 420, wide: 900, min: 4.6, max: 7.5 };
const MAX_DPR = 2;
const K = 8; // supersampling per diode when rasterising
const MIN_CAP = 4; // smallest cap height, in diodes
const LINE = 1; // baseline-to-baseline step, in em
// Share of a diode's area the ink must cover to light it. Small type uses a stricter cut so
// overshooting curves do not add stray diodes.
const INK = 0.44;
const INK_SMALL = 0.5;
const SMALL_CAP = 11;
const PROMPT_INK = 0.42;

const DOT = 0.37; // diode radius, in pitches
const HALO = 1.6; // glow reach beyond a diode's cell, in pitches
const HALO_ALPHA = 0.3;
const UNLIT = 'rgba(255,150,70,.075)';
const AMBER = { core: '#FFF0D6', on: '#FFB45E', glow: '255,128,32' };
const WHITE = { core: '#FFFFFF', on: '#FFF3E4', glow: '255,214,170' };
const PROMPT_GAIN = 0.96;

// The bus-window glyphs, a chevron and an underscore, in the mark's units.
const CHEVRON = 'M385.5,532.5 L495.7,604.3 Q517.5,618.5 495.7,632.7 L385.5,704.5 Q378.0,709.4 373.1,701.9 L356.9,677.1 Q352.0,669.6 359.6,664.7 L426.3,621.2 Q430.5,618.5 426.3,615.8 L359.6,572.3 Q352.0,567.4 356.9,559.9 L373.1,535.1 Q378.0,527.6 385.5,532.5 Z';
const MARK = { left: 352, top: 527.6, bottom: 709.4, chevronRight: 517.5, barWidth: 167 * 0.72, barHeight: 46, barRadius: 11 };
const MARK_HEIGHT = MARK.bottom - MARK.top;
const MARK_GAP = 0.05 * MARK_HEIGHT; // between the chevron and the underscore
// Prompt width per diode of prompt height.
const PROMPT_WIDTH = (MARK.chevronRight - MARK.left + MARK_GAP + MARK.barWidth) / MARK_HEIGHT;

let fontLoaded = false;

try {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
} catch {
  // Every board keeps its fallback text.
}

function init() {
  const elements = document.querySelectorAll('[data-led-sign]');
  if (!elements.length) return;
  const webfont = loadFont();
  const fontWait = Promise.race([webfont, new Promise(resolve => window.setTimeout(resolve, FONT_TIMEOUT))]);
  for (const element of elements) {
    try {
      const board = mountBoard(element);
      if (!board) continue;
      fontWait.then(board.start);
      // A webfont that arrives after the timeout replaces the fallback rasterisation.
      webfont.then(loaded => {
        if (loaded) board.refresh();
      });
    } catch {
      // This board keeps its fallback text.
    }
  }
}

function loadFont() {
  let request;
  try {
    request = document.fonts?.load(FONT_PROBE);
  } catch {
    // Treated as not loaded.
  }
  return Promise.resolve(request).then(faces => {
    fontLoaded = Array.isArray(faces) && faces.length > 0;
    return fontLoaded;
  }, () => false);
}

function mountBoard(element) {
  const stops = (element.dataset.stops || '').split('|').map(stop => stop.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!stops.length || !('ResizeObserver' in window) || element.querySelector('.led-sign-canvas')) return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const scratch = document.createElement('canvas');
  const sx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx || !sx) return null;
  canvas.className = 'led-sign-canvas';
  canvas.setAttribute('aria-hidden', 'true');

  const controller = new AbortController();
  const listenerOptions = { signal: controller.signal };
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let layout; // diode grid, text plan and rasterised stops; undefined until the first paint
  let size; // latest content-box size and board width from the ResizeObserver
  let current = 0; // index of the stop on the board
  let roll; // { from, to, start, shift } while rolling to the next stop
  let frame = 0;
  let timer;
  let deadline = 0;
  let remaining = HOLD_FIRST;
  let resizeTimer;
  let resizeObserver;
  let observer;
  let inView = !('IntersectionObserver' in window);
  let failed = false;

  const canPlay = () => !failed && layout !== undefined && stops.length > 1 && !motion.matches && !document.hidden && inView;
  const guard = fn => (...args) => {
    if (failed) return;
    try {
      fn(...args);
    } catch {
      fail();
    }
  };

  function fail() {
    failed = true;
    window.clearTimeout(timer);
    window.clearTimeout(resizeTimer);
    window.cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    observer?.disconnect();
    controller.abort();
    canvas.remove();
    element.removeAttribute('data-led-ready');
  }

  function relayout() {
    resizeTimer = undefined;
    if (!size) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const cssPitch = PITCH.min + (PITCH.max - PITCH.min) * clamp((size.board - PITCH.narrow) / (PITCH.wide - PITCH.narrow));
    // Whole device pixels per diode, so every diode lands on the pixel grid the same way.
    const pitch = Math.max(3, Math.round(cssPitch * dpr));
    const width = Math.round(size.width * dpr);
    const height = Math.round(size.height * dpr);
    const cols = Math.floor(width / pitch);
    const rows = Math.floor(height / pitch);
    // Hidden or too small to read: keep the current paint, or the fallback before the first one.
    if (!(cols >= 16 && rows >= 6)) return;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const key = `${width}x${height}/${pitch}/${fontLoaded}`;
    if (layout?.key === key) return;

    settle();
    canvas.width = width;
    canvas.height = height;
    scratch.width = cols * K;
    scratch.height = rows * K;
    const sprites = makeSprites(pitch);
    const vary = new Float32Array(cols * rows);
    for (let i = 0; i < vary.length; i++) vary[i] = variance(i);
    const plan = planText(sx, cols, rows, stops[0]);
    layout = {
      key,
      pitch,
      cols,
      rows,
      x0: (width - cols * pitch) >> 1,
      y0: (height - rows * pitch) >> 1,
      vary,
      sprites,
      unlit: ctx.createPattern(sprites.unlit, 'repeat'),
      prompt: rasterPrompt(sx, plan.promptBox, cols, rows),
      textCol: plan.textCol,
      clipRow: plan.clipRow,
      place: plan.place,
      pages: [],
    };
    if (!canvas.isConnected) element.append(canvas);
    paint();
    element.setAttribute('data-led-ready', '');
    schedule();
  }

  function cellsFor(index) {
    if (!layout.pages[index]) layout.pages[index] = rasterStop(stops[index]);
    return layout.pages[index];
  }

  function rasterStop(text) {
    const placed = layout.place(text);
    clear(sx);
    sx.font = font(placed.size * K);
    const spacing = tracking(placed.size) * K;
    placed.lines.forEach((line, i) => drawLine(sx, line, layout.textCol * K, placed.baselines[i] * K, spacing));
    return scan(sx, layout.cols, layout.rows, placed.cap < SMALL_CAP ? INK_SMALL : INK);
  }

  // pages: [{ cells, dr }], lit diode indices shifted by dr rows and clipped above layout.clipRow.
  function paint(pages = [{ cells: cellsFor(current), dr: 0 }]) {
    const { pitch, cols, rows, x0, y0, sprites, unlit, prompt, clipRow } = layout;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(1, 0, 0, 1, x0, y0);
    ctx.fillStyle = unlit;
    ctx.fillRect(0, 0, cols * pitch, rows * pitch);
    // Glow first, added up so dense strokes bloom, then the diodes on top in their own colour.
    ctx.globalCompositeOperation = 'lighter';
    diodes(prompt, 0, 0, sprites.whiteHalo, PROMPT_GAIN);
    for (const page of pages) diodes(page.cells, page.dr, clipRow, sprites.amberHalo, 1);
    ctx.globalCompositeOperation = 'source-over';
    diodes(prompt, 0, 0, sprites.white, PROMPT_GAIN);
    for (const page of pages) diodes(page.cells, page.dr, clipRow, sprites.amber, 1);
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function diodes(cells, dr, minRow, sprite, gain) {
    const { pitch, cols, rows, vary } = layout;
    const offset = (sprite.width - pitch) / 2;
    for (let k = 0; k < cells.length; k++) {
      const q = cells[k] % cols;
      const r = (cells[k] - q) / cols + dr;
      if (r < minRow || r >= rows) continue;
      ctx.globalAlpha = vary[r * cols + q] * gain;
      ctx.drawImage(sprite, q * pitch - offset, r * pitch - offset);
    }
  }

  function pause() {
    if (timer !== undefined) {
      remaining = Math.max(RESUME_MIN, deadline - performance.now());
      window.clearTimeout(timer);
      timer = undefined;
    }
    if (roll) {
      settle();
      paint();
    }
  }

  // Land a roll on its destination without painting.
  function settle() {
    if (!roll) return;
    window.cancelAnimationFrame(frame);
    frame = 0;
    current = roll.to;
    roll = undefined;
    remaining = current === 0 ? HOLD_FIRST : HOLD;
  }

  function schedule() {
    if (!canPlay() || timer !== undefined || roll) return;
    deadline = performance.now() + remaining;
    timer = window.setTimeout(flip, remaining);
  }

  const step = guard(now => {
    frame = 0;
    if (!roll) return;
    const progress = clamp((now - roll.start) / ROLL);
    if (progress >= 1) {
      settle();
      paint();
      schedule();
      return;
    }
    // The old stop rolls up and out while the next one rises from below, a whole diode row at a time.
    const span = layout.rows - layout.clipRow;
    const shift = Math.round(easeInOutCubic(progress) * span);
    if (shift !== roll.shift) {
      roll.shift = shift;
      paint([{ cells: cellsFor(roll.from), dr: -shift }, { cells: cellsFor(roll.to), dr: span - shift }]);
    }
    frame = window.requestAnimationFrame(step);
  });

  const flip = guard(() => {
    timer = undefined;
    if (!canPlay()) return;
    const to = (current + 1) % stops.length;
    // Rasterise both stops before the clock starts.
    cellsFor(current);
    cellsFor(to);
    roll = { from: current, to, start: performance.now(), shift: -1 };
    frame = window.requestAnimationFrame(step);
  });

  const resize = guard(relayout);

  const start = guard(() => {
    resizeObserver = new ResizeObserver(guard(entries => {
      const entry = entries[entries.length - 1];
      const box = entry.contentBoxSize?.[0];
      const border = entry.borderBoxSize?.[0];
      size = {
        width: box ? box.inlineSize : entry.contentRect.width,
        height: box ? box.blockSize : entry.contentRect.height,
        board: border ? border.inlineSize : element.offsetWidth,
      };
      window.clearTimeout(resizeTimer);
      // Paint the first layout at once; let later resizes settle before rasterising again.
      if (layout) resizeTimer = window.setTimeout(resize, RESIZE_DELAY);
      else relayout();
    }));
    resizeObserver.observe(element);
    if ('IntersectionObserver' in window) {
      observer = new window.IntersectionObserver(guard(entries => {
        inView = entries[entries.length - 1].isIntersecting;
        if (!inView) pause();
        schedule();
      }), { threshold: 0 });
      observer.observe(element);
    }
    document.addEventListener('visibilitychange', guard(() => {
      if (document.hidden) pause();
      schedule();
    }), listenerOptions);
    motion.addEventListener('change', guard(() => {
      pause();
      if (motion.matches) {
        current = 0;
        remaining = HOLD_FIRST;
        if (layout) paint();
      }
      schedule();
    }), listenerOptions);
  });

  const refresh = guard(() => {
    if (layout) relayout();
  });

  return { start, refresh };
}

// Fits every stop on a cols × rows board. The first stop picks the arrangement and the type size:
// the prompt beside the text, or above it when that makes the first stop at least 1.2× larger.
// Later stops share both and only shrink when they do not fit.
function planText(sx, cols, rows, firstStop) {
  const measure = measurer(sx);
  const capRatio = measure('H').ascent || 0.7275;
  const descRatio = measure('g').descent || 0.21;
  const marginX = Math.max(2, Math.round(cols * 0.03));
  const marginY = Math.max(2, Math.round(rows * 0.08));
  const usableCols = cols - 2 * marginX;
  const usableRows = rows - 2 * marginY;
  const sizeFor = cap => cap / capRatio; // font size in diodes for a cap height
  const lead = size => Math.round(LINE * size);
  const twoLines = cap => cap + lead(sizeFor(cap)) + descRatio * sizeFor(cap);
  const lineWidth = (line, size) => {
    const metrics = measure(line);
    return metrics.width * size + tracking(size) * (metrics.chars - 1);
  };
  const inkHeight = (lines, size) =>
    measure(lines[0]).ascent * size + lead(size) * (lines.length - 1) + measure(lines[lines.length - 1]).descent * size;
  const largest = fits => {
    let cap = MIN_CAP;
    while (cap < 400 && fits(cap + 1)) cap++;
    return cap;
  };

  // The largest cap height up to maxCap at which some wrap of at most two lines fits; fewer lines
  // win ties, then the narrower wrap.
  function fit(text, maxCap, roomWidth, roomHeight) {
    const options = wraps(text);
    for (let cap = maxCap; cap >= MIN_CAP; cap--) {
      const size = sizeFor(cap);
      let best;
      for (const lines of options) {
        const width = Math.max(...lines.map(line => lineWidth(line, size)));
        if (width > roomWidth(cap) || inkHeight(lines, size) > roomHeight(cap)) continue;
        if (!best || lines.length < best.lines.length || (lines.length === best.lines.length && width < best.width)) {
          best = { cap, size, lines, width };
        }
      }
      if (best) return best;
    }
    // Nothing fits: the smallest size and the narrowest wrap; the canvas clips the overflow.
    const size = sizeFor(MIN_CAP);
    return options
      .map(lines => ({ cap: MIN_CAP, size, lines, width: Math.max(...lines.map(line => lineWidth(line, size))) }))
      .reduce((a, b) => (b.width < a.width ? b : a));
  }

  // Side by side: the prompt spans both text lines and the destination sits to its right.
  const sidePrompt = cap => Math.round(0.74 * (cap + lead(sizeFor(cap))));
  const sideGap = cap => Math.max(2, Math.round(0.58 * cap));
  const side = fit(firstStop, largest(cap => twoLines(cap) <= usableRows),
    cap => usableCols - Math.ceil(PROMPT_WIDTH * sidePrompt(cap)) - sideGap(cap), () => usableRows);
  // Stacked: a small prompt above the destination, for tall boards.
  const stackPrompt = cap => Math.max(5, cap);
  const stackGap = cap => Math.max(2, Math.round(cap / 3));
  const stackRoom = cap => usableRows - stackPrompt(cap) - stackGap(cap);
  const stack = fit(firstStop, largest(cap => twoLines(cap) <= stackRoom(cap)), () => usableCols, stackRoom);
  const stacked = stack.cap >= 1.2 * side.cap;

  const cap = stacked ? stack.cap : side.cap;
  let promptBox, textCol, areaTop, areaHeight, maxHeight, clipRow;
  // Each stop's ink is centred in the text area.
  const baseline = (lines, size) =>
    Math.round(areaTop + Math.max(0, (areaHeight - inkHeight(lines, size)) / 2) + measure(lines[0]).ascent * size);
  if (stacked) {
    const height = stackPrompt(cap);
    const gap = stackGap(cap);
    const block = twoLines(cap);
    const top = marginY + Math.floor((usableRows - height - gap - block) / 2);
    const left = marginX + Math.max(0, Math.floor((usableCols - Math.ceil(Math.max(stack.width, PROMPT_WIDTH * height))) / 2));
    promptBox = { height, col: left, row: top };
    textCol = left;
    areaTop = top + height + gap;
    areaHeight = block;
    maxHeight = rows - marginY - areaTop;
    clipRow = top + height + 1;
  } else {
    const height = sidePrompt(cap);
    const width = Math.ceil(PROMPT_WIDTH * height);
    const gap = sideGap(cap);
    const left = marginX + Math.max(0, Math.floor((usableCols - width - gap - Math.ceil(side.width)) / 2));
    textCol = left + width + gap;
    areaTop = marginY;
    areaHeight = usableRows;
    maxHeight = usableRows;
    clipRow = 0;
    // Centre the prompt on the first stop's span from cap top to last baseline.
    const capTop = baseline(side.lines, side.size) - cap;
    const span = cap + lead(side.size) * (side.lines.length - 1);
    promptBox = { height, col: left, row: Math.round(capTop + (span - height) / 2) };
  }
  const availWidth = cols - marginX - textCol;

  function place(text) {
    const placed = fit(text, cap, () => availWidth, () => maxHeight);
    const first = baseline(placed.lines, placed.size);
    return { ...placed, baselines: placed.lines.map((_, i) => first + lead(placed.size) * i) };
  }

  return { promptBox, textCol, clipRow, place };
}

// Text metrics in em, measured once per text at 100px.
function measurer(sx) {
  const cache = new Map();
  return text => {
    let metrics = cache.get(text);
    if (!metrics) {
      sx.font = font(100);
      const m = sx.measureText(text);
      metrics = {
        width: m.width / 100,
        ascent: (m.actualBoundingBoxAscent ?? 72.75) / 100,
        descent: Math.max(0, m.actualBoundingBoxDescent ?? 21) / 100,
        chars: Array.from(text).length,
      };
      cache.set(text, metrics);
    }
    return metrics;
  };
}

// The text unbroken, then every split into two lines at a space.
function wraps(text) {
  const words = text.split(' ');
  const options = [[text]];
  for (let k = 1; k < words.length; k++) options.push([words.slice(0, k).join(' '), words.slice(k).join(' ')]);
  return options;
}

// Draws one line character by character to add tracking (canvas letterSpacing is not universal).
// The ink, not the pen, starts at x, so every stop lines up on the same diode column.
function drawLine(sx, line, x, y, spacing) {
  const chars = Array.from(line);
  const left = x + (sx.measureText(chars[0]).actualBoundingBoxLeft || 0);
  let prefix = '';
  chars.forEach((char, i) => {
    prefix += char;
    if (char === ' ') return;
    // Kerned pen position: the prefix's advance minus this character's own.
    const pen = sx.measureText(prefix).width - sx.measureText(char).width;
    sx.fillText(char, left + pen + i * spacing, y);
  });
}

function rasterPrompt(sx, box, cols, rows) {
  clear(sx);
  const scale = (box.height / MARK_HEIGHT) * K;
  sx.setTransform(scale, 0, 0, scale, box.col * K - MARK.left * scale, box.row * K - MARK.top * scale);
  sx.fill(new Path2D(CHEVRON));
  // The underscore sits on the chevron's bottom edge.
  roundedRect(sx, MARK.chevronRight + MARK_GAP, MARK.bottom - MARK.barHeight, MARK.barWidth, MARK.barHeight, MARK.barRadius);
  sx.fill();
  sx.setTransform(1, 0, 0, 1, 0, 0);
  return scan(sx, cols, rows, PROMPT_INK);
}

function roundedRect(c, x, y, width, height, radius) {
  c.beginPath();
  c.moveTo(x + radius, y);
  c.arcTo(x + width, y, x + width, y + height, radius);
  c.arcTo(x + width, y + height, x, y + height, radius);
  c.arcTo(x, y + height, x, y, radius);
  c.arcTo(x, y, x + width, y, radius);
  c.closePath();
}

function clear(sx) {
  sx.setTransform(1, 0, 0, 1, 0, 0);
  sx.clearRect(0, 0, sx.canvas.width, sx.canvas.height);
  sx.fillStyle = '#fff';
  sx.textAlign = 'left';
  sx.textBaseline = 'alphabetic';
}

// Lights each diode whose K × K block of the supersampled drawing is covered past the threshold.
function scan(sx, cols, rows, threshold) {
  const width = cols * K;
  const data = sx.getImageData(0, 0, width, rows * K).data;
  const need = threshold * K * K * 255;
  const lit = [];
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      let sum = 0;
      for (let y = r * K; y < (r + 1) * K; y++) {
        for (let i = (y * width + q * K) * 4 + 3, end = i + K * 4; i < end; i += 4) sum += data[i];
      }
      if (sum >= need) lit.push(r * cols + q);
    }
  }
  return Int32Array.from(lit);
}

// Diode and glow sprites, drawn once per pitch so every frame is plain image copies.
function makeSprites(pitch) {
  const radius = DOT * pitch;
  const reach = Math.ceil(HALO * pitch);
  const sprite = (size, draw) => {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    draw(c.getContext('2d'), size / 2);
    return c;
  };
  const diode = ({ core, on, glow }) => sprite(pitch, (c, mid) => {
    const gradient = c.createRadialGradient(mid - radius * 0.25, mid - radius * 0.25, 0, mid, mid, radius);
    gradient.addColorStop(0, core);
    gradient.addColorStop(0.55, on);
    gradient.addColorStop(1, `rgba(${glow},.9)`);
    c.fillStyle = gradient;
    c.beginPath();
    c.arc(mid, mid, radius, 0, Math.PI * 2);
    c.fill();
  });
  const halo = ({ glow }) => sprite(pitch + 2 * reach, (c, mid) => {
    const gradient = c.createRadialGradient(mid, mid, 0, mid, mid, mid);
    for (const [at, alpha] of [[0, 1], [0.2, 0.72], [0.45, 0.3], [0.7, 0.08], [1, 0]]) {
      gradient.addColorStop(at, `rgba(${glow},${alpha * HALO_ALPHA})`);
    }
    c.fillStyle = gradient;
    c.fillRect(0, 0, mid * 2, mid * 2);
  });
  const unlit = sprite(pitch, (c, mid) => {
    c.fillStyle = UNLIT;
    c.beginPath();
    c.arc(mid, mid, radius, 0, Math.PI * 2);
    c.fill();
  });
  return { amber: diode(AMBER), amberHalo: halo(AMBER), white: diode(WHITE), whiteHalo: halo(WHITE), unlit };
}

// Stable per-diode brightness variance: real panels are never perfectly even.
function variance(i) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return 0.86 + ((h >>> 0) / 4294967295) * 0.14;
}

function font(px) {
  return `800 ${px}px ${FONT}`;
}

// Letter spacing in diodes, so heavy strokes stay apart once rasterised.
function tracking(size) {
  return Math.max(0.5, 0.055 * size);
}

function clamp(value) {
  return Math.min(1, Math.max(0, value));
}

function easeInOutCubic(p) {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}
