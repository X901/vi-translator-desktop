// Snapshots: the game's whole picture with every bit of its text translated in place, like a translated
// photo. Shared by the app's window and the home-network page: `Snap.draw` paints a snapshot on a canvas,
// `Snap.show` opens it full screen (Translated / Original, save, close).
window.Snap = (() => {
  const RTL = new Set(["ar", "ur", "fa"]);
  const SCRIPT = { hi: '"Nirmala UI", ', bn: '"Nirmala UI", ', ta: '"Nirmala UI", ', te: '"Nirmala UI", ', mr: '"Nirmala UI", ', th: '"Leelawadee UI", ' };
  const family = (lang) => `"Tajawal", ${SCRIPT[lang] || ""}"Segoe UI", "Noto Sans", Tahoma, sans-serif`;

  const load = (src) =>
    new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => fail(new Error("picture"));
      img.src = src;
    });

  const rgb = (hex) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
  };
  const light = (hex) => {
    const [r, g, b] = rgb(hex);
    return 0.299 * r + 0.587 * g + 0.114 * b > 140;
  };

  // A block's translation as words, each with its color (the game's highlights kept).
  function words(block) {
    const out = [];
    for (const [text, c] of block.segs || []) {
      if (c && c.startsWith("icon:")) continue;
      const color = c && /^#[0-9a-f]{6}$/i.test(c) ? c : c && /^name:#[0-9a-f]{6}$/i.test(c) ? c.slice(5) : block.fg;
      for (const w of String(text).split(/\s+/)) if (w) out.push({ w, color });
    }
    return out;
  }

  // The biggest size at which the words wrap into the block's box (a little taller allowed).
  function layout(ctx, list, font, box, startSize) {
    for (let size = startSize; size >= 7; size *= 0.92) {
      ctx.font = `600 ${size}px ${font}`;
      const space = ctx.measureText(" ").width;
      const lines = [];
      let line = [], width = 0;
      for (const it of list) {
        const ww = ctx.measureText(it.w).width;
        if (line.length && width + space + ww > box.w) {
          lines.push({ items: line, width });
          line = [];
          width = 0;
        }
        line.push({ ...it, ww });
        width += (line.length > 1 ? space : 0) + ww;
      }
      if (line.length) lines.push({ items: line, width });
      const lh = size * 1.28;
      const fits = lines.every((l) => l.width <= box.w * 1.02) && lines.length * lh <= box.h * 1.25;
      if (fits || size * 0.92 < 7) return { size, lines, lh, space };
    }
  }

  /** Paint `snap` on `canvas`: the picture, and (translated) every block's translation over its English. */
  async function draw(canvas, snap, { translated = true, style = "blur" } = {}) {
    const src = translated && snap.translated_image ? snap.translated_image : snap.image;
    const img = await load(src);
    const W = img.naturalWidth, H = img.naturalHeight;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, W, H);
    if (!translated || snap.translated_image) return;
    const font = family(snap.lang);
    const rtl = RTL.has(snap.lang);
    try {
      await document.fonts.load(`600 24px Tajawal`);
    } catch {}
    for (const b of snap.blocks || []) {
      const list = words(b);
      if (!list.length) continue;
      const lhPx = Math.max(8, b.line_h * H);
      const pad = Math.max(3, lhPx * 0.28);
      const box = { x: b.rect[0] * W - pad, y: b.rect[1] * H - pad, w: b.rect[2] * W + 2 * pad, h: b.rect[3] * H + 2 * pad };
      const [r, g, bl] = rgb(b.bg);
      // the English covered: the picture blurred under the background's color, or the color alone
      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(box.x, box.y, box.w, box.h, Math.min(8, pad));
      else ctx.rect(box.x, box.y, box.w, box.h);
      ctx.clip();
      if (style === "blur") {
        ctx.filter = `blur(${Math.max(6, lhPx * 0.7).toFixed(1)}px)`;
        ctx.drawImage(img, 0, 0, W, H);
        ctx.filter = "none";
        ctx.fillStyle = `rgba(${r},${g},${bl},0.82)`;
      } else {
        ctx.fillStyle = `rgb(${r},${g},${bl})`;
      }
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.restore();

      const inner = { x: box.x + pad * 0.4, y: box.y + pad * 0.3, w: box.w - pad * 0.8, h: box.h - pad * 0.6 };
      const L = layout(ctx, list, font, inner, lhPx * 0.95);
      if (!L) continue;
      ctx.font = `600 ${L.size}px ${font}`;
      ctx.textBaseline = "middle";
      ctx.direction = rtl ? "rtl" : "ltr";
      ctx.textAlign = "left";
      // (a light letter gets a soft dark shadow, a dark one a light glow: readable over what's left of the picture)
      const total = L.lines.length * L.lh;
      let y = inner.y + (inner.h - total) / 2 + L.lh / 2;
      for (const line of L.lines) {
        // (one line: on the English's left edge, so a column of labels stays lined up; a paragraph in a
        // right-to-left language on its right edge)
        const startX = b.align === "center" ? inner.x + (inner.w - line.width) / 2 : rtl && L.lines.length > 1 ? inner.x + inner.w - line.width : inner.x;
        // right-to-left: the first word on the right
        const order = rtl ? [...line.items].reverse() : line.items;
        let x = startX;
        for (const it of order) {
          ctx.shadowColor = light(it.color) ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.55)";
          ctx.shadowBlur = L.size * 0.18;
          ctx.fillStyle = it.color;
          ctx.fillText(it.w, x, y);
          x += it.ww + L.space;
        }
        y += L.lh;
      }
      ctx.shadowBlur = 0;
    }
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  /**
   * Full-screen viewer. labels: { translated, original, save, close, folder }; actions: { save(canvas, snap),
   * folder() } (each button shows only with its action). style: "blur" | "solid".
   */
  async function show(snap, { labels = {}, actions = {}, style = "blur", info = "", onClose = null } = {}) {
    document.getElementById("snap-view")?.remove();
    const L = { translated: "Translated", original: "Original", save: "Save", close: "Close", folder: "Open folder", ...labels };
    const view = document.createElement("div");
    view.id = "snap-view";
    view.setAttribute("role", "dialog");
    view.style.cssText = "position:fixed;inset:0;z-index:1000;background:rgba(8,6,16,.94);display:flex;flex-direction:column;font-family:'Segoe UI',system-ui,sans-serif";
    const btn = "border:1px solid #3a3063;background:#1d1733;color:#f3eefe;border-radius:8px;padding:7px 12px;font-size:14px;cursor:pointer";
    view.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;padding:10px 12px;flex-wrap:wrap">
        <div style="display:flex;border:1px solid #3a3063;border-radius:8px;overflow:hidden">
          <button data-k="t" style="${btn};border:0;border-radius:0">${esc(L.translated)}</button>
          <button data-k="o" style="${btn};border:0;border-radius:0">${esc(L.original)}</button>
        </div>
        <span style="flex:1;color:#b7aed6;font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(info)}</span>
        ${actions.save ? `<button data-k="s" style="${btn}">${esc(L.save)}</button>` : ""}
        ${actions.folder ? `<button data-k="f" style="${btn}">${esc(L.folder)}</button>` : ""}
        <button data-k="x" style="${btn}" aria-label="${esc(L.close)}">✕</button>
      </div>
      <div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:0 12px 12px">
        <canvas style="max-width:100%;max-height:100%;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,.6)"></canvas>
      </div>`;
    document.body.appendChild(view);
    const canvas = view.querySelector("canvas");
    let translated = true;
    const mark = () => view.querySelectorAll("[data-k=t],[data-k=o]").forEach((b) => {
      const on = (b.dataset.k === "t") === translated;
      b.style.background = on ? "#d42e78" : "#1d1733";
    });
    const paint = async () => {
      mark();
      await draw(canvas, snap, { translated, style });
    };
    const close = () => {
      if (!view.isConnected) return;
      view.remove();
      document.removeEventListener("keydown", key);
      if (onClose) onClose();
    };
    const key = (e) => {
      if (e.key === "Escape") close();
      if (e.key === " " || e.key === "o") {
        translated = !translated;
        paint();
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", key);
    view.addEventListener("click", async (e) => {
      const k = e.target.closest("[data-k]")?.dataset.k;
      if (k === "t" || k === "o") {
        translated = k === "t";
        paint();
      } else if (k === "x") close();
      else if (k === "s") {
        const c = document.createElement("canvas");
        await draw(c, snap, { translated, style });
        actions.save(c, snap, translated);
      } else if (k === "f") actions.folder();
    });
    await paint();
    return { close };
  }

  /** The snapshot drawn translated, as a PNG data URL (to keep it). */
  async function png(snap, style = "blur") {
    const c = document.createElement("canvas");
    await draw(c, snap, { translated: true, style });
    return c.toDataURL("image/png");
  }

  return { draw, show, png };
})();
