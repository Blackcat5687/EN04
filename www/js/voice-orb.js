/**
 * voice-orb.js — مؤشر بصري هادئ لحالة المحادثة الصوتية (استماع/تفكير/كلام/تصحيح)
 * بديل عن نص "جاري التحميل" — نبضة دائرية ناعمة تتغيّر سرعتها ولونها حسب الحالة
 */

class VoiceOrb {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._resize();
    this.state = 'idle'; // idle | listening | thinking | ai-speaking | ai-correcting | completed
    this.t = 0;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._raf = null;
    this._loop = this._loop.bind(this);
  }

  _resize() {
    const size = 180;
    this.canvas.width = size * this.dpr;
    this.canvas.height = size * this.dpr;
    this.canvas.style.width = size + 'px';
    this.canvas.style.height = size + 'px';
    this.ctx.scale(this.dpr, this.dpr);
    this.size = size;
  }

  _colorsFor(state) {
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim() || '#8A6F5C';
    const success = styles.getPropertyValue('--success').trim() || '#4F7A6B';
    const warning = styles.getPropertyValue('--warning').trim() || '#B98A3D';
    const tertiary = styles.getPropertyValue('--text-tertiary').trim() || '#A69C8E';

    switch (state) {
      case 'listening': return { core: success, speed: 1.4, amp: 10 };
      case 'thinking': return { core: warning, speed: 2.6, amp: 6 };
      case 'ai-speaking': return { core: accent, speed: 1.8, amp: 13 };
      case 'ai-correcting': return { core: warning, speed: 2.0, amp: 12 };
      case 'completed': return { core: success, speed: 0.6, amp: 4 };
      default: return { core: tertiary, speed: 0.5, amp: 3 };
    }
  }

  setState(state) {
    this.state = state;
  }

  start() {
    if (this._raf) return;
    this._loop();
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _loop() {
    this.t += 0.016;
    this._draw();
    if (!this.reducedMotion) {
      this._raf = requestAnimationFrame(this._loop);
    } else {
      this._raf = requestAnimationFrame(this._loop);
    }
  }

  _draw() {
    const { ctx, size } = this;
    const cx = size / 2;
    const cy = size / 2;
    const { core, speed, amp } = this._colorsFor(this.state);

    ctx.clearRect(0, 0, size, size);

    const effectiveAmp = this.reducedMotion ? amp * 0.25 : amp;
    const pulse = Math.sin(this.t * speed) * 0.5 + 0.5;
    const baseRadius = 46;
    const radius = baseRadius + pulse * effectiveAmp;

    // هالة خارجية ناعمة
    const gradient = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius * 1.9);
    gradient.addColorStop(0, this._withAlpha(core, 0.28));
    gradient.addColorStop(1, this._withAlpha(core, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.9, 0, Math.PI * 2);
    ctx.fill();

    // الحلقة الوسطى
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.25, 0, Math.PI * 2);
    ctx.fillStyle = this._withAlpha(core, 0.14);
    ctx.fill();

    // القلب الصلب
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = core;
    ctx.fill();

    if (this.state === 'ai-speaking' && !this.reducedMotion) {
      // موجة صوت بسيطة داخل القلب أثناء كلام الـ AI
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.72, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = this._withAlpha('#FFFFFF', 0.55);
      ctx.lineWidth = 2;
      for (let i = -2; i <= 2; i++) {
        const barX = cx + i * 9;
        const barH = 10 + Math.abs(Math.sin(this.t * 6 + i)) * 16;
        ctx.beginPath();
        ctx.moveTo(barX, cy - barH / 2);
        ctx.lineTo(barX, cy + barH / 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  _withAlpha(hex, alpha) {
    // يدعم صيغة hex فقط؛ يرجع rgba
    let c = hex.trim();
    if (c.startsWith('#')) {
      const bigint = parseInt(c.slice(1), 16);
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      return `rgba(${r},${g},${b},${alpha})`;
    }
    return c;
  }
}

window.VoiceOrb = VoiceOrb;
