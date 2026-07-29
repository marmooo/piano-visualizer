// effect.js — particle effect definitions for PianoVisualizer

/**
 * Each effect exposes:
 *   spawn(x, y, color, particles, options)  → push particles into the array
 *   update(particles, dt)                   → mutate / filter in place (return new length or mutate length)
 *   render(ctx, particles, options)         → draw
 *
 * Particle common fields:
 *   x, y, vx, vy, life, maxLife, color
 * Extra fields are free per effect.
 */

const TAU = Math.PI * 2;

/** amount: 0=元の色, 1=白。0.4〜0.5 程度が自然 */
function brightenColor(color, amount = 0.45) {
  const hex = String(color).trim();
  let r, g, b, a = 1;

  if (hex.startsWith("#")) {
    if (hex.length === 4) {
      r = parseInt(hex[1] + hex[1], 16);
      g = parseInt(hex[2] + hex[2], 16);
      b = parseInt(hex[3] + hex[3], 16);
    } else {
      r = parseInt(hex.slice(1, 3), 16);
      g = parseInt(hex.slice(3, 5), 16);
      b = parseInt(hex.slice(5, 7), 16);
    }
  } else {
    const m = hex.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m) return color;
    r = +m[1];
    g = +m[2];
    b = +m[3];
    if (m[4] !== undefined) a = +m[4];
  }

  r = Math.round(r + (255 - r) * amount);
  g = Math.round(g + (255 - g) * amount);
  b = Math.round(b + (255 - b) * amount);

  return a < 1 ? `rgba(${r},${g},${b},${a})` : `rgb(${r},${g},${b})`;
}

function pushBurst(x, y, color, particles, n = 14) {
  for (let i = 0; i < n; i++) {
    const speed = 80 + Math.random() * 200;
    const ang = Math.random() * TAU;
    particles.push({
      x: x + (Math.random() - 0.5) * 8,
      y: y + (Math.random() - 0.5) * 8,
      vx: Math.cos(ang) * speed * (0.4 + Math.random() * 1.2),
      vy: Math.sin(ang) * speed * (0.4 + Math.random() * 1.2),
      life: 0.6 + Math.random() * 0.9,
      maxLife: 0.6 + Math.random() * 0.9,
      color,
      size: 3 + Math.random() * 4,
    });
  }
}

// ---- shared helpers -------------------------------------------------------

function gravityUpdate(particles, dt, gravity = 400) {
  let wi = 0;
  for (const p of particles) {
    p.vy += gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life > 0) particles[wi++] = p;
  }
  particles.length = wi;
}

function simpleUpdate(particles, dt) {
  let wi = 0;
  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life > 0) particles[wi++] = p;
  }
  particles.length = wi;
}

function alphaOf(p) {
  return Math.max(0, Math.min(1, p.life / p.maxLife));
}

// ---- effects --------------------------------------------------------------

export const particleEffects = {
  // Original burst (explosion)
  burst: {
    spawn(x, y, color, particles) {
      pushBurst(x, y, color, particles, 14 + Math.floor(Math.random() * 8));
    },
    update: (particles, dt) => gravityUpdate(particles, dt, 400),
    render(ctx, particles) {
      let lastColor = null;
      for (const p of particles) {
        const a = alphaOf(p);
        ctx.globalAlpha = a;
        if (p.color !== lastColor) {
          ctx.fillStyle = p.color;
          lastColor = p.color;
        }
        const size = (p.size ?? 4) + 5 * (1 - a);
        ctx.beginPath();
        ctx.roundRect(p.x, p.y, size, size, size * 0.3);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },

  // Sparks — sharp, fast, short-lived, slight upward bias
  spark: {
    spawn(x, y, color, particles) {
      const n = 10 + Math.floor(Math.random() * 10);
      for (let i = 0; i < n; i++) {
        const speed = 150 + Math.random() * 350;
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.8; // mostly upward
        particles.push({
          x: x + (Math.random() - 0.5) * 6,
          y: y + (Math.random() - 0.5) * 6,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          life: 0.25 + Math.random() * 0.45,
          maxLife: 0.25 + Math.random() * 0.45,
          color,
          length: 6 + Math.random() * 10,
        });
      }
    },
    update: (particles, dt) => gravityUpdate(particles, dt, 200),
    render(ctx, particles) {
      ctx.lineCap = "round";
      for (const p of particles) {
        const a = alphaOf(p);
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5 + 2 * a;
        const len = p.length * a;
        const speed = Math.hypot(p.vx, p.vy) || 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - (p.vx / speed) * len, p.y - (p.vy / speed) * len);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  },

  // Steam / smoke — soft, rising, drifting
  steam: {
    spawn(x, y, color, particles) {
      const n = 8 + Math.floor(Math.random() * 6);
      for (let i = 0; i < n; i++) {
        const life = 1.0 + Math.random() * 1.4;
        particles.push({
          x: x + (Math.random() - 0.5) * 18,
          y: y + (Math.random() - 0.5) * 6,
          vx: (Math.random() - 0.5) * 28,
          vy: -25 - Math.random() * 55,
          life,
          maxLife: life,
          color,
          size: 10 + Math.random() * 16,
          grow: 12 + Math.random() * 18,
          wobble: Math.random() * Math.PI * 2,
          wobbleSpeed: 1.5 + Math.random() * 2.5,
        });
      }
    },
    update(particles, dt) {
      let wi = 0;
      for (const p of particles) {
        p.wobble += p.wobbleSpeed * dt;
        p.vx += Math.sin(p.wobble) * 35 * dt;
        p.vx *= 0.98;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy *= 0.985; // 徐々に減速
        p.size += p.grow * dt;
        p.life -= dt;
        if (p.life > 0) particles[wi++] = p;
      }
      particles.length = wi;
    },
    render(ctx, particles) {
      for (const p of particles) {
        const t = p.life / p.maxLife;
        const a = t * t * 0.05; // 0.4 → 0.2 で全体を薄く
        if (a < 0.01) continue;
        const r = p.size * 0.5;

        ctx.globalAlpha = a * 0.35;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.35, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },

  // Electric — jagged short bolts + small sparks
  electric: {
    spawn(x, y, color, particles) {
      // core sparks
      const n = 8 + Math.floor(Math.random() * 8);
      for (let i = 0; i < n; i++) {
        const speed = 120 + Math.random() * 280;
        const ang = Math.random() * TAU;
        particles.push({
          type: "spark",
          x: x + (Math.random() - 0.5) * 4,
          y: y + (Math.random() - 0.5) * 4,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          life: 0.15 + Math.random() * 0.3,
          maxLife: 0.15 + Math.random() * 0.3,
          color,
        });
      }
      // one or two short arcs
      for (let i = 0; i < 1 + Math.floor(Math.random() * 2); i++) {
        const ang = Math.random() * TAU;
        const len = 20 + Math.random() * 40;
        particles.push({
          type: "arc",
          x,
          y,
          endX: x + Math.cos(ang) * len,
          endY: y + Math.sin(ang) * len,
          life: 0.08 + Math.random() * 0.12,
          maxLife: 0.08 + Math.random() * 0.12,
          color,
          jagged: 3 + Math.floor(Math.random() * 4),
        });
      }
    },
    update(particles, dt) {
      let wi = 0;
      for (const p of particles) {
        if (p.type === "spark") {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.92;
          p.vy *= 0.92;
        }
        // arcs just fade
        p.life -= dt;
        if (p.life > 0) particles[wi++] = p;
      }
      particles.length = wi;
    },
    render(ctx, particles) {
      ctx.lineCap = "round";
      for (const p of particles) {
        const a = alphaOf(p);
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.color;
        if (p.type === "arc") {
          ctx.lineWidth = 1.5 + 2 * a;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          const segs = p.jagged;
          for (let i = 1; i <= segs; i++) {
            const t = i / segs;
            const jx = (Math.random() - 0.5) * 12 * (1 - Math.abs(t - 0.5) * 2);
            const jy = (Math.random() - 0.5) * 12 * (1 - Math.abs(t - 0.5) * 2);
            ctx.lineTo(
              p.x + (p.endX - p.x) * t + jx,
              p.y + (p.endY - p.y) * t + jy,
            );
          }
          ctx.stroke();
        } else {
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    },
  },

  // Fire — upward flames with color shift feel (uses same color, size grows then shrinks)
  fire: {
    spawn(x, y, color, particles) {
      const n = 12 + Math.floor(Math.random() * 8);
      for (let i = 0; i < n; i++) {
        const life = 0.55 + Math.random() * 0.7;
        const speed = 50 + Math.random() * 90;
        particles.push({
          x: x + (Math.random() - 0.5) * 12,
          y: y + (Math.random() - 0.5) * 3,
          vx: (Math.random() - 0.5) * 28,
          vy: -speed,
          life,
          maxLife: life,
          color,
          hotColor: brightenColor(color, 0.3),
          w: 4 + Math.random() * 5,
          h: 11 + Math.random() * 16,
          phase: Math.random() * Math.PI * 2,
          phase2: Math.random() * Math.PI * 2,
          phaseSpeed: 6 + Math.random() * 7,
          phaseSpeed2: 9 + Math.random() * 11,
        });
      }
    },
    update(particles, dt) {
      let wi = 0;
      for (const p of particles) {
        p.phase += p.phaseSpeed * dt;
        p.phase2 += p.phaseSpeed2 * dt;
        p.vx += (Math.sin(p.phase) * 0.55 + Math.sin(p.phase2) * 0.45) * 85 *
          dt;
        p.vx *= 0.91;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy *= 0.978;
        p.life -= dt;
        if (p.life > 0) particles[wi++] = p;
      }
      particles.length = wi;
    },
    render(ctx, particles) {
      const prev = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = "lighter";

      for (const p of particles) {
        const t = p.life / p.maxLife;
        if (t < 0.04) continue;

        // かなり薄く（ノートが透ける優先）
        const bodyA = Math.pow(t, 0.45) * 0.04;
        const coreA = Math.pow(t, 1.05) * 0.03;
        const scale = 0.5 + t * 0.7;
        const w = p.w * scale;
        const h = p.h * scale;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.sin(p.phase) * 0.12);

        // 外側ぼかし
        ctx.globalAlpha = bodyA * 0.45;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, w * 2.4, h * 1.8, 0, 0, Math.PI * 2);
        ctx.fill();

        // 本体
        ctx.globalAlpha = bodyA;
        ctx.beginPath();
        ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
        ctx.fill();

        // ごく薄いコア
        if (coreA > 0.02) {
          ctx.globalAlpha = coreA;
          ctx.fillStyle = p.hotColor;
          ctx.beginPath();
          ctx.ellipse(0, h * 0.1, w * 0.4, h * 0.35, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }

      ctx.globalCompositeOperation = prev;
      ctx.globalAlpha = 1;
    },
  },

  // Star / sparkle — twinkling points that expand slightly
  star: {
    spawn(x, y, color, particles) {
      const n = 6 + Math.floor(Math.random() * 8);
      for (let i = 0; i < n; i++) {
        const speed = 40 + Math.random() * 120;
        const ang = Math.random() * TAU;
        particles.push({
          x: x + (Math.random() - 0.5) * 10,
          y: y + (Math.random() - 0.5) * 10,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          life: 0.5 + Math.random() * 0.8,
          maxLife: 0.5 + Math.random() * 0.8,
          color,
          size: 2 + Math.random() * 3,
          rot: Math.random() * TAU,
          spin: (Math.random() - 0.5) * 8,
        });
      }
    },
    update(particles, dt) {
      let wi = 0;
      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.rot += p.spin * dt;
        p.life -= dt;
        if (p.life > 0) particles[wi++] = p;
      }
      particles.length = wi;
    },
    render(ctx, particles) {
      for (const p of particles) {
        const a = alphaOf(p);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const s = p.size * (1 + (1 - a) * 0.5);
        // 4-point star
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const ang = (i / 4) * TAU;
          ctx.lineTo(Math.cos(ang) * s, Math.sin(ang) * s);
          ctx.lineTo(
            Math.cos(ang + Math.PI / 4) * s * 0.35,
            Math.sin(ang + Math.PI / 4) * s * 0.35,
          );
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
  },

  // Bubble — rising translucent circles
  bubble: {
    spawn(x, y, color, particles) {
      const n = 4 + Math.floor(Math.random() * 5);
      for (let i = 0; i < n; i++) {
        particles.push({
          x: x + (Math.random() - 0.5) * 20,
          y: y + (Math.random() - 0.5) * 8,
          vx: (Math.random() - 0.5) * 30,
          vy: -40 - Math.random() * 70,
          life: 0.7 + Math.random() * 1.0,
          maxLife: 0.7 + Math.random() * 1.0,
          color,
          size: 4 + Math.random() * 10,
        });
      }
    },
    update(particles, dt) {
      let wi = 0;
      for (const p of particles) {
        p.vx += (Math.random() - 0.5) * 20 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life > 0) particles[wi++] = p;
      }
      particles.length = wi;
    },
    render(ctx, particles) {
      for (const p of particles) {
        const a = alphaOf(p) * 0.55;
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size / 2, 0, TAU);
        ctx.stroke();
        // highlight
        ctx.globalAlpha = a * 0.4;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(
          p.x - p.size * 0.15,
          p.y - p.size * 0.15,
          p.size * 0.15,
          0,
          TAU,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },

  // Confetti — falling colored rectangles
  confetti: {
    spawn(x, y, color, particles) {
      const n = 10 + Math.floor(Math.random() * 10);
      for (let i = 0; i < n; i++) {
        const speed = 60 + Math.random() * 180;
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
        particles.push({
          x: x + (Math.random() - 0.5) * 14,
          y: y + (Math.random() - 0.5) * 8,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          life: 0.8 + Math.random() * 1.2,
          maxLife: 0.8 + Math.random() * 1.2,
          color,
          w: 3 + Math.random() * 5,
          h: 2 + Math.random() * 4,
          rot: Math.random() * TAU,
          spin: (Math.random() - 0.5) * 12,
        });
      }
    },
    update: (particles, dt) => {
      let wi = 0;
      for (const p of particles) {
        p.vy += 280 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
        p.life -= dt;
        if (p.life > 0) particles[wi++] = p;
      }
      particles.length = wi;
    },
    render(ctx, particles) {
      for (const p of particles) {
        const a = alphaOf(p);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
  },
};

export const particleEffectNames = Object.keys(particleEffects);
