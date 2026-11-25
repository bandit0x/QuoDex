window.quotaConcepts = {};
window.Q = (() => {
  const groups = ['gemini', 'partner', 'web'];
  const periods = ['five', 'week'];
  const names = {gemini: 'AG Gemini', partner: 'AG Claude/GPT', web: 'Gemini Web'};
  const tileIndex = {gemini: 2, partner: 3, web: 1};
  const initial = {gemini: {five: 82, week: 16}, partner: {five: 24, week: 90}, web: {five: 68, week: 55}};
  let values = structuredClone(initial);
  const states = {gemini: 'normal', partner: 'normal', web: 'normal'};
  let empty = false;
  const atlas = new Image();
  const last = new WeakMap();
  let frame = 0;

  function read(group, period) {
    const state = states[group];
    if (empty || (state === 'missing' && period === 'week')) return {value: null, stale: false};
    return {value: values[group][period], stale: state === 'old' && period === 'week'};
  }

  function value(group, period) {
    const reading = read(group, period);
    const spoken = names[group] + ' ' + (period === 'five' ? '5 小时' : '一周');
    const label = reading.value === null ? '未读' : (reading.stale ? '上次剩余 ' : '剩余 ') + reading.value + '%';
    const mark = reading.stale ? '<small class="q-old">上次</small>' : '';
    const digits = reading.value === null ? '—' : reading.value + '%';
    return '<span class="q-value" data-group="' + group + '" data-period="' + period + '" aria-label="' + spoken + '，' + label + '">' + digits + mark + '</span>';
  }

  function liquid(group, period, direction = 'vertical') {
    return '<canvas class="q-liquid" aria-hidden="true" data-source="' + group + '" data-period="' + period + '" data-direction="' + direction + '"></canvas>';
  }

  // Match the shipped atlas's dry cavity, photographed meniscus and foot.
  // Rotating that same mapping gives the horizontal tube a moving cap at the right.
  function draw(canvas, amount, time, stir) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width, height = canvas.height;
    const horizontal = canvas.dataset.direction === 'horizontal';
    const w = horizontal ? height : width;
    const h = horizontal ? width : height;
    const edge = atlas.naturalHeight;
    ctx.save();
    if (horizontal) {
      ctx.translate(width, 0);
      ctx.rotate(Math.PI / 2);
    }
    ctx.drawImage(atlas, 0, 0, edge, edge, 0, 0, w, h);
    if (amount > 0) {
      const level = amount / 100;
      const center = h * (0.94 - 0.8 * level);
      const depth = h * Math.min(0.087, 0.39 * level, 0.035 + 0.4 * (1 - level));
      const xTile = tileIndex[canvas.dataset.source] * edge;
      const strips = stir > 0.01 ? Math.min(16, w) : 1;
      ctx.globalAlpha = Math.min(1, level / 0.045);
      for (let i = 0; i < strips; i++) {
        const left = Math.round(i * w / strips);
        const right = Math.round((i + 1) * w / strips);
        const pos = (left + right) / (2 * w);
        const wave = Math.sin(pos * Math.PI * 2.2 + time * 0.013) * Math.sin(pos * Math.PI) * h * 0.019 * stir;
        const back = center - depth + wave;
        const front = center + depth + wave;
        const foot = Math.max(h * 0.79, front + 0.2 * (h - front));
        function band(from, to, top, bottom) {
          ctx.drawImage(atlas, xTile + left / w * edge, from * edge, (right-left)/w*edge, (to-from)*edge,
            left, top, right-left, bottom-top);
        }
        band(0.35, 0.54, back, front);
        band(0.54, 0.79, front, foot);
        band(0.79, 1, foot, h);
      }
    }
    ctx.restore();
  }

  function paint() {
    cancelAnimationFrame(frame);
    if (!atlas.naturalHeight) return;
    const surfaces = [...document.querySelectorAll('canvas.q-liquid')].flatMap(canvas => {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return [];
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(bounds.width * dpr));
      const height = Math.max(1, Math.round(bounds.height * dpr));
      const target = read(canvas.dataset.source, canvas.dataset.period).value;
      if (canvas.width === width && canvas.height === height && last.has(canvas) && last.get(canvas) === target) return [];
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const start = target === null ? null : last.get(canvas) ?? target;
      return [{canvas, start, target}];
    });
    const animate = !matchMedia('(prefers-reduced-motion: reduce)').matches && surfaces.some(s => s.start !== s.target);
    const began = performance.now();
    function tick(now) {
      const t = animate ? Math.min(1, Math.max(0,(now - began) / 380)) : 1;
      for (const {canvas, start, target} of surfaces) {
        const amount = target === null ? null : target + (start - target) * (1 - t) ** 3;
        last.set(canvas, amount);
        draw(canvas, amount, now, target === start ? 0 : Math.sin(t * Math.PI));
      }
      if (t < 1) frame = requestAnimationFrame(tick);
    }
    tick(began);
  }
  atlas.addEventListener('load', paint);
  atlas.src = '../../../../src/gemini-glass.webp';
  return {
    names, groups, periods, read, value, liquid, paint,
    raw: (group, period) => values[group][period],
    state: group => empty ? 'empty' : states[group],
    edit(group, period, amount) { values[group][period] = amount; },
    setState(group, state) { empty = state === 'empty'; if (!empty) states[group] = state; },
    reset() { values = structuredClone(initial); for (const group of groups) states[group] = 'normal'; empty = false; }
  };
})();
