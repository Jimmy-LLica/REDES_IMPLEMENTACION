'use strict';

const Parcela3D = (() => {
  const PLOTS = [
    { x: -5.1, z: -4.25 }, { x: 5.1, z: -4.25 },
    { x: -5.1, z: 4.25 }, { x: 5.1, z: 4.25 }
  ];
  const START = { yaw: 0.48, pitch: 0.70, distance: 34 };
  const BED_WIDTH = 8.7;
  const BED_LENGTH = 6.8;
  const GREEN = ['#437552', '#5e9360', '#6ba46d', '#88b879', '#aec589'];
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const dot = (p, v) => p[0] * v[0] + p[1] * v[1] + p[2] * v[2];

  function surface(list, points, fill) {
    const middle = [0, 1, 2].map((axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length);
    list.push({ points, fill, middle });
  }

  function box(list, x, y, z, width, height, depth, [top, front, side]) {
    const a = x - width / 2;
    const b = x + width / 2;
    const c = z - depth / 2;
    const d = z + depth / 2;
    const u = y + height;
    surface(list, [[a, u, c], [b, u, c], [b, u, d], [a, u, d]], top);
    surface(list, [[a, y, c], [b, y, c], [b, u, c], [a, u, c]], front);
    surface(list, [[a, y, d], [b, y, d], [b, u, d], [a, u, d]], front);
    surface(list, [[a, y, c], [a, y, d], [a, u, d], [a, u, c]], side);
    surface(list, [[b, y, c], [b, y, d], [b, u, d], [b, u, c]], side);
  }

  function cylinder(list, x, y, z, radius, height, colors) {
    const ring = Array.from({ length: 22 }, (_, i) => {
      const angle = i * Math.PI / 11;
      return [x + Math.cos(angle) * radius, y + height, z + Math.sin(angle) * radius];
    });
    ring.forEach((point, i) => {
      const next = ring[(i + 1) % ring.length];
      const shade = Math.round((1 + Math.sin(i * Math.PI / 11 + 0.45)) * (colors.length - 2) / 2);
      surface(list, [point, next, [next[0], y, next[2]], [point[0], y, point[2]]], colors[shade + 1]);
    });
    surface(list, ring, colors[0]);
  }

  function plant(list, x, z, height, twist) {
    const origin = [x, 0.30, z];
    for (let i = 0; i < 4; i++) {
      const angle = twist + i * Math.PI / 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const middle = [x + dx * 0.19, 0.3 + height * 0.63, z + dz * 0.19];
      const tip = [x + dx * 0.34, 0.3 + height * (0.76 + i * 0.07), z + dz * 0.34];
      surface(list, [origin, [middle[0] - dz * .13, middle[1] - .06, middle[2] + dx * .13], tip, middle], GREEN[i]);
      surface(list, [origin, middle, tip, [middle[0] + dz * .1, middle[1] - .07, middle[2] - dx * .1]], GREEN[i + 1]);
    }
  }

  const crops = [];
  PLOTS.forEach(({ x, z }, plot) => {
    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 7; column++) {
        const seed = (plot * 37 + row * 11 + column * 17) % 19;
        plant(crops, x + (column - 3) * 1.06, z + (row - 2) * 1.06, .42 + seed * .018, seed * .53);
      }
    }
  });
  const fixtures = [];
  box(fixtures, -10.95, 0.04, 0, 2.05, .22, 2.8, ['#aab4a7', '#868e80', '#778579']);
  cylinder(fixtures, -11.05, .26, .14, .79, 1.46, ['#81b9c5', '#477d8d', '#5c99a8', '#71afbc', '#86b9c3']);
  cylinder(fixtures, -11.05, 1.72, .14, .86, .12, ['#b7d2d2', '#6797a0', '#83adb3', '#9abec2']);
  cylinder(fixtures, -11.05, 1.84, .14, .26, .15, ['#4c7777', '#577b7d', '#789c9b']);
  box(fixtures, -10.94, .26, -1.0, .65, .46, .61, ['#4a6b62', '#305649', '#395750']);

  const pipes = (objects, active) => {
    const idle = ['#638480', '#3e5b57', '#536b62'];
    const wet = ['#58c6db', '#2386a7', '#328e9e'];
    const feed = PLOTS[active]?.x ?? -10.55;
    const joints = [-10.55, -5.1, 5.1, 5.55];
    for (let i = 1; i < joints.length; i++) {
      const start = joints[i - 1];
      const end = joints[i];
      box(objects, (start + end) / 2, .17, 0, end - start, .17, .19, end <= feed ? wet : idle);
    }
    PLOTS.forEach(({ x, z }, i) => {
      const open = active === i;
      box(objects, x, .22, z / 2, .17, .15, Math.abs(z), open ? wet : idle);
      cylinder(objects, x, .36, Math.sign(z) * .79, .25, .15, open
        ? ['#4dcce7', '#268aa6', '#32a6c0']
        : ['#92a49a', '#496457', '#64766f']);
      for (const offset of [-1.58, 0, 1.58]) {
        box(objects, x, .32, z + offset, .15, .47, .15, open ? wet : idle);
        box(objects, x, .79, z + offset, .28, .12, .28, open ? wet : idle);
      }
    });
  };

  function create(canvas, buttons) {
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let camera = { ...START };
    let current;
    let visible = false;
    let queued = false;
    let drag;
    let lastSignature;

    function queue() {
      if (!queued && visible) {
        queued = true;
        requestAnimationFrame(draw);
      }
    }

    function draw(time) {
      queued = false;
      if (!visible || !current || !ctx || canvas.clientWidth === 0) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const { yaw, pitch, distance } = camera;
      const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
      const up = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch)];
      const forward = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
      const focal = Math.min(width * 1.14, height * 1.52);
      const project = (point) => {
        const scale = focal / (distance - dot(point, forward));
        return [width * .5 + dot(point, right) * scale, height * .55 - dot(point, up) * scale];
      };
      function polygon(points, fill) {
        ctx.beginPath();
        for (const [i, point] of points.entries()) {
          if (i === 0) ctx.moveTo(...point);
          else ctx.lineTo(...point);
        }
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }
      function paint(faces) {
        faces.sort((a, b) => dot(a.middle, forward) - dot(b.middle, forward));
        for (const face of faces) polygon(face.points.map(project), face.fill);
      }

      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, '#e8f2ee');
      sky.addColorStop(.52, '#edf0e6');
      sky.addColorStop(1, '#e3dfcd');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);
      polygon([[0, height * .31], [width * .17, height * .22], [width * .28, height * .25], [width * .48, height * .15],
        [width * .68, height * .25], [width * .84, height * .21], [width, height * .27], [width, height * .46], [0, height * .46]], '#d2d9cb');
      polygon([[0, height * .34], [width * .21, height * .30], [width * .35, height * .37], [width * .61, height * .31],
        [width * .79, height * .34], [width, height * .29], [width, height * .54], [0, height * .49]], '#dedfce');

      const shadow = [[-13.4, -.55, -9.6], [13.5, -.55, -9.6], [13.5, -.55, 10.3], [-13.4, -.55, 10.3]];
      polygon(shadow.map(project), '#cbcab67d');
      const ground = [];
      box(ground, 0, -.64, 0, 25.5, .65, 18.8, ['#e6d9b9', '#bcab8b', '#caba9a']);
      paint(ground);
      const beds = [];
      const furrows = [];
      PLOTS.forEach(({ x, z }, i) => {
        const open = i === current.active;
        box(beds, x, .02, z, BED_WIDTH + .28, .11, BED_LENGTH + .22, open
          ? ['#4d9bb2', '#517782', '#4e8498']
          : ['#ad9877', '#a39173', '#c6b08d']);
        box(beds, x, .12, z, BED_WIDTH, .18, BED_LENGTH, open
          ? ['#866f56', '#6a5849', '#77644f']
          : ['#a48360', '#8d7051', '#93775a']);
        for (let row = 0; row < 5; row++) {
          box(furrows, x, .301, z + (row - 2) * 1.06, 7.8, .018, .31,
            open ? ['#625c4b', '#625c4b', '#625c4b'] : ['#8d7657', '#8d7657', '#8d7657']);
        }
      });
      paint(beds);
      paint(furrows);
      const scene = [...crops, ...fixtures];
      pipes(scene, current.flow > 0 ? current.active : null);
      paint(scene);

      if (current.active !== null && current.flow > 0) {
        const { x, z } = PLOTS[current.active];
        const length = x + 10.55;
        const elapsed = reduceMotion.matches ? 400 : time;
        for (let i = 0; i < 13; i++) {
          const position = ((elapsed * .0027 + i * .88) % (length + Math.abs(z)));
          const world = position < length ? [-10.55 + position, .41, 0] : [x, .42, Math.sign(z) * (position - length)];
          const [sx, sy] = project(world);
          ctx.fillStyle = '#d2faff';
          ctx.beginPath();
          ctx.arc(sx, sy, width < 500 ? 1.4 : 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        if (current.pressure > 0) {
          const pressure = Math.max(.25, current.pressure / 1.8);
          const rate = Math.max(.25, current.flow / 12);
          const seconds = elapsed / 1000;
          const reach = 3.25 * pressure;
          for (const [sprinkler, offset] of [-1.58, 0, 1.58].entries()) {
            for (const side of [-1, 1]) {
              const bend = Math.sin(seconds * 2.8 + sprinkler * 1.3) * .55;
              for (const fan of [-.34, .34]) {
                const world = (phase) => [
                  x + side * reach * phase,
                  .89 + pressure * 2.36 * phase * (1 - phase) * 2.6 - .58 * phase * phase,
                  z + offset + (bend + fan) * phase
                ];
                ctx.beginPath();
                for (let segment = 0; segment <= 12; segment++) {
                  const point = project(world(segment / 12));
                  if (segment === 0) ctx.moveTo(...point);
                  else ctx.lineTo(...point);
                }
                ctx.lineCap = 'round';
                ctx.lineWidth = width < 500 ? 2.5 : 3.5;
                ctx.strokeStyle = 'rgba(3, 89, 133, 0.43)';
                ctx.stroke();
                ctx.lineWidth = width < 500 ? 1.3 : 2.15;
                ctx.strokeStyle = 'rgba(86, 225, 251, 0.92)';
                ctx.stroke();
                for (let i = 0; i < 6; i++) {
                  const phase = (seconds * (.95 + rate * .7) + i / 6 + sprinkler * .19) % 1;
                  const [sx, sy] = project(world(phase));
                  ctx.beginPath();
                  ctx.fillStyle = i % 2 ? '#9cf1ff' : '#f0fcff';
                  ctx.arc(sx, sy, width < 500 ? 1.1 : 1.65, 0, Math.PI * 2);
                  ctx.fill();
                }
              }
            }
          }
        }
      }

      const labels = PLOTS.map(({ x, z }, i) => ({
        index: i, point: [x, 1.63, z + .4]
      })).sort((a, b) => dot(a.point, forward) - dot(b.point, forward));
      for (const { index, point } of labels) {
        const sector = current.sectors[index];
        const [x, y] = project(point);
        const small = width < 500;
        const text = sector.id + '  ' + (sector.valid
          ? sector.moisture.toLocaleString('es-ES', { maximumFractionDigits: current.measured ? 2 : 1 }) + ' %' : '—');
        ctx.font = `650 ${small ? 9 : 12}px "DM Sans", "Segoe UI", sans-serif`;
        const w = ctx.measureText(text).width + (small ? 10 : 15);
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - 12, w, small ? 19 : 24, 6);
        ctx.fillStyle = sector.open ? '#135f76' : '#edf1e8';
        ctx.fill();
        ctx.strokeStyle = sector.open ? '#aee9f2' : '#879984';
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = sector.open ? '#e7fcff' : '#304b3d';
        ctx.fillText(text, x, small ? y - 2 : y);
      }
      if (current.active !== null && current.flow > 0 && !reduceMotion.matches) queue();
    }

    function orbit(x, y) {
      camera.yaw -= x * .008;
      camera.pitch = clamp(camera.pitch + y * .009, .28, 1.35);
      queue();
    }

    function zoom(delta) {
      camera.distance = clamp(camera.distance + delta, 21, 56);
      queue();
    }

    function reset() {
      camera = { ...START };
      queue();
    }

    canvas.addEventListener('pointerdown', (event) => {
      if (drag || event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (drag?.id !== event.pointerId) return;
      orbit(event.clientX - drag.x, event.clientY - drag.y);
      drag.x = event.clientX;
      drag.y = event.clientY;
    });
    canvas.addEventListener('lostpointercapture', (event) => {
      if (drag?.id === event.pointerId) drag = null;
    });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      zoom(clamp(event.deltaY * .029, -5, 5));
    }, { passive: false });
    canvas.addEventListener('keydown', (event) => {
      const keys = {
        ArrowLeft: () => orbit(-14, 0), ArrowRight: () => orbit(14, 0),
        ArrowUp: () => orbit(0, -12), ArrowDown: () => orbit(0, 12),
        '+': () => zoom(-3), '-': () => zoom(3), Home: reset
      };
      if (!Object.hasOwn(keys, event.key)) return;
      event.preventDefault();
      keys[event.key]();
    });
    buttons.in.addEventListener('click', () => zoom(-3));
    buttons.out.addEventListener('click', () => zoom(3));
    buttons.reset.addEventListener('click', reset);
    new ResizeObserver(queue).observe(canvas);
    reduceMotion.addEventListener('change', queue);
    return {
      visibility(value) { visible = value; queue(); },
      setState(data) {
        current = data;
        const signature = [data.active, data.flow, data.pressure,
          ...data.sectors.map((sector) => sector.valid ? sector.moisture.toFixed(data.measured ? 2 : 1) : '—')].join('/');
        if (signature !== lastSignature) {
          lastSignature = signature;
          queue();
        }
      }
    };
  }

  return { create };
})();
