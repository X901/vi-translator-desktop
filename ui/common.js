// Shared by the main window (preview) and the overlay windows, so both draw the Arabic identically.
window.AS = (() => {
  // Target language (set by each page from the settings): its direction, and fonts for its script
  // after the chosen font (Hindi, Bengali, Tamil … and Thai need Windows' own fonts for their letters).
  const RTL = new Set(["ar", "ur", "fa"]);
  const SCRIPT_FONTS = { hi: '"Nirmala UI"', bn: '"Nirmala UI"', ta: '"Nirmala UI"', te: '"Nirmala UI"', mr: '"Nirmala UI"', th: '"Leelawadee UI"' };
  let lang = "ar";
  const setLang = (code) => { lang = code || "ar"; };
  const rtl = () => RTL.has(lang);
  const dir = () => (rtl() ? "rtl" : "ltr");
  const fonts = () => `${SCRIPT_FONTS[lang] ? SCRIPT_FONTS[lang] + ", " : ""}"Segoe UI", Tahoma, sans-serif`;
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // Arabic with Latin bits ("GTA+", "GTA$500,000", "rsg.ms/gtaplus"): each Latin run is shown
  // left-to-right on its own, so right-to-left text can't move its "+" or "$" ("+GTA").
  const ltrRuns = (s) => {
    const text = String(s).replace(/[⁦⁩]/g, "");
    // (Latin words in a row are one run, "Pay 'n' Spray": each on its own, right-to-left would put them in
    // reverse order)
    const re = /[A-Za-z0-9](?:[A-Za-z0-9$+\/™%&_-]|[.,](?=[A-Za-z0-9])|['’](?=\s*[A-Za-z0-9])|\s+(?=['’]?[A-Za-z0-9]))*[$+%™]?/g;
    let out = "", last = 0, m;
    while ((m = re.exec(text))) {
      out += esc(text.slice(last, m.index)) + `<bdi dir="ltr">${esc(m[0])}</bdi>`;
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  };

  // A text box's words with the game's button icons where it says ⟦1⟧, ⟦2⟧ … (`icons`: PNG data URLs),
  // each about as tall as the letters and sitting on the line like one.
  const withIcons = (s, icons) =>
    String(s)
      .split(/(⟦\d+⟧)/)
      .map((part) => {
        const m = /^⟦(\d+)⟧$/.exec(part);
        const src = m && icons && icons[Number(m[1]) - 1];
        if (m) return src && /^data:image\/png;base64,/.test(src) ? `<img src="${esc(src)}" alt="" style="height:1.15em;width:auto;vertical-align:-0.25em;margin:0 0.12em">` : "";
        return ltrRuns(part);
      })
      .join("");

  const hexToRgb = (hex) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
  };

  // The game draws the other speaker's subtitle line in grey.
  const DIM = "#9a9a9a";

  // Segments -> HTML. Color segments become colored spans; "icon:<png>" segments become the game's
  // button icon, sized to the text (1.2em) and sitting on the line like a letter.
  function segHtml(segments, keepColors = true) {
    return segments
      .map(([t, c]) => {
        // two speakers' lines: each on its own line, as in the game
        if (t === "\n" && !c) return "<br>";
        // the other speaker's line: grey like the game's, also with highlight colors off
        if (c === "dim") return `<span style="color:${DIM}">${esc(t)}</span>`;
        // a speaker name ("Dobbs:"): in the game's color for it, also with highlight colors off
        if (c && c.startsWith("name:")) return `<span style="color:${esc(c.slice(5))}">${esc(t)}</span>`;
        if (c && c.startsWith("icon:")) {
          // "icon:<height vs English text>|<png>" — keep the icon's size relative to the text, as in the game
          let src = c.slice(5);
          let h = 1.2; // em, for icons without a measured size
          const bar = src.indexOf("|");
          if (bar > 0 && !src.startsWith("data:")) {
            const rel = parseFloat(src.slice(0, bar));
            if (rel > 0) h = Math.min(Math.max(rel / MATCH_FACTOR, 0.4), 1.6);
            src = src.slice(bar + 1);
          }
          const drop = (0.35 - h / 2).toFixed(3); // centre it on the letters' middle
          return `<img src="${esc(src)}" alt="" style="height:${h.toFixed(3)}em;width:auto;vertical-align:${drop}em;margin:0 0.15em">`;
        }
        return c && keepColors ? `<span style="color:${esc(c)}">${esc(t)}</span>` : esc(t);
      })
      .join("");
  }

  // Same formula as overlay.rs `overlay_rect`: where the Arabic is drawn for an area.
  // `a` is the read area in pixels; `area` (the config object) supplies the custom region.
  function rectFor(placement, a, cw, ch, area) {
    if (placement === "custom" && area) {
      const w = Math.min(Math.max(area.out_w * cw, 20), cw);
      const h = Math.min(Math.max(area.out_h * ch, 20), ch);
      return {
        x: Math.min(Math.max(area.out_x * cw, 0), cw - w),
        y: Math.min(Math.max(area.out_y * ch, 0), ch - h),
        w,
        h,
      };
    }
    if (placement === "under_text") {
      const h = Math.min(a.h + Math.floor(ch * 0.4), ch);
      const w = Math.min(Math.max(a.w, 50), cw);
      return { x: Math.min(Math.max(a.x, 0), cw - w), y: Math.min(Math.max(a.y, 0), ch - h), w, h };
    }
    if (placement === "above_text") {
      // the read area and room above it (the Arabic sits right above the game's text)
      const h = Math.min(a.h + Math.floor(ch * 0.4), ch);
      const w = Math.min(Math.max(a.w, 50), cw);
      return { x: Math.min(Math.max(a.x, 0), cw - w), y: Math.min(Math.max(a.y + a.h - h, 0), ch - h), w, h };
    }
    const band = Math.floor(ch * 0.4);
    const side = Math.floor(cw * 0.35);
    let r;
    switch (placement) {
      case "below": r = [a.x, a.y + a.h, a.w, band]; break;
      case "right": r = [a.x + a.w, a.y, side, band]; break;
      case "left": r = [a.x - side, a.y, side, band]; break;
      case "over": r = [a.x, a.y + a.h - band, a.w, band]; break;
      default: r = [a.x, a.y - band, a.w, band];
    }
    let [x, y, w, h] = r;
    w = Math.min(Math.max(w, 50), cw);
    h = Math.min(Math.max(h, 50), ch);
    x = Math.min(Math.max(x, 0), cw - w);
    y = Math.min(Math.max(y, 0), ch - h);
    return { x, y, w, h };
  }

  // Where the text box sits inside its region: {v: top|middle|bottom, h: left|center|right}.
  function alignOf(placement, area) {
    if (placement === "under_text") return { v: "top", h: "left" };
    if (placement === "above_text") return { v: "bottom", h: "center" };
    if (placement === "custom" && area) return { v: area.out_valign || "bottom", h: area.out_halign || "center" };
    if (area && area.text_pos) {
      const [v, h] = area.text_pos.split("-");
      if (v && h) return { v, h };
    }
    return {
      v: placement === "above" || placement === "over" ? "bottom" : "top",
      h: placement === "right" ? "left" : placement === "left" ? "right" : "center",
    };
  }

  // Flex alignment of the box inside its band.
  function anchor(container, placement, area) {
    const al = alignOf(placement, area);
    const s = container.style;
    if (atText(placement)) {
      s.display = "block"; // the box is placed exactly by placeAtText
      return;
    }
    s.display = "flex";
    s.flexDirection = "column";
    s.alignItems = { left: "flex-start", center: "center", right: "flex-end" }[al.h];
    s.justifyContent = { top: "flex-start", middle: "center", bottom: "flex-end" }[al.v];
  }

  // segments: [[text, color|null], ...]; k: CSS px per style px (style sizes are for a 1080p window).
  // Arabic size relative to the English line height (OCR word height) when matching the game's size.
  const MATCH_FACTOR = 1.2;

  // fontPx: exact font size in CSS px (from the English line height); otherwise style size × fontScale × k.
  function renderBox(box, segments, style, k, fontScale, placement, area, fontPx) {
    const plain = segments.map((s) => (s[1] && s[1].startsWith("icon:") ? "🎮" : s[0])).join("").trim();
    if (!plain) {
      box.style.display = "none";
      box.innerHTML = "";
      return;
    }
    box.innerHTML = segHtml(segments, style.keep_colors);
    const [r, g, b] = hexToRgb(style.bg_color);
    const ow = style.outline_width * k;
    const shadows = [];
    if (ow > 0) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        shadows.push(`${(Math.cos(a) * ow).toFixed(2)}px ${(Math.sin(a) * ow).toFixed(2)}px 0 ${style.outline_color}`);
      }
    }
    if (style.shadow) shadows.push(`0 ${2 * k}px ${6 * k}px rgba(0,0,0,0.85)`);
    const fs = Math.max(8, fontPx || style.font_size * fontScale * k);
    const bgMode = (area && area.background) || "";
    Object.assign(box.style, {
      display: "block",
      direction: dir(),
      unicodeBidi: "plaintext",
      // Centred boxes centre their lines; boxes pinned to a side keep the language's natural side.
      textAlign: alignOf(placement, area).h === "center" ? "center" : rtl() ? "right" : "left",
      fontFamily: `"${(area && area.font_family) || style.font_family}", ${fonts()}`,
      fontSize: `${fs}px`,
      fontWeight: style.bold ? "700" : "400",
      lineHeight: String(style.line_height),
      color: style.text_color,
      background: `rgba(${r},${g},${b},${style.bg_opacity})`,
      padding: `${style.padding * k}px ${style.padding * 1.8 * k}px`,
      borderRadius: `${style.radius * k}px`,
      textShadow: shadows.join(", ") || "none",
      maxWidth: "calc(100% - 8px)",
      margin: "4px",
      boxSizing: "border-box",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    });
    if (bgMode === "none") {
      // Like the game's own text: no box, a soft shadow, and a thin dark outline unless the style
      // says none (GTA VI's subtitles and instructions have only the shadow).
      const o = style.outline_width * k;
      const ring = [];
      for (let i = 0; o > 0 && i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        ring.push(`${(Math.cos(a) * o).toFixed(2)}px ${(Math.sin(a) * o).toFixed(2)}px 0 ${style.outline_color || "#000"}`);
      }
      // a soft shadow only when the style asks for one (GTA VI's subtitles have a border and no shadow)
      if (style.shadow) ring.push(`0 ${2 * k}px ${5 * k}px rgba(0,0,0,0.9)`);
      if (o <= 0) ring.push(`0 0 ${2 * k}px rgba(0,0,0,0.6)`); // (keeps it readable over a bright floor)
      Object.assign(box.style, { background: "transparent", padding: `${2 * k}px ${4 * k}px`, borderRadius: "0", textShadow: ring.join(", ") });
    } else if (bgMode === "game") {
      // Like GTA's help box: dark, see-through, square corners.
      Object.assign(box.style, { background: "rgba(10,10,10,0.62)", borderRadius: "0", padding: `${9 * k}px ${14 * k}px`, textShadow: "none" });
    }
  }

  // ---- Game pages (a menu, a "mission failed" page …) ------------------------------------------
  // L: layout from the backend (all rects are fractions of the game frame).
  // reasonSegs: Arabic segments for the reason line. opts: { title_font, text_font }.
  // root: element covering exactly the game picture (overlay window or preview layer).
  function renderScreen(root, L, reasonSegs, opts) {
    root.innerHTML = "";
    if (!L) return;
    const W = root.clientWidth;
    const H = root.clientHeight;
    const shadow = (fs) => `0 ${(fs * 0.05).toFixed(1)}px ${(fs * 0.08).toFixed(1)}px rgba(0,0,0,0.8)`;
    const mk = (css, html) => {
      const d = document.createElement("div");
      // (no object spread in this file: 2018 Samsung TVs draw it too, Chromium 56)
      Object.assign(d.style, { position: "absolute", whiteSpace: "nowrap", direction: dir(), lineHeight: "1.15" }, css);
      d.innerHTML = html;
      root.appendChild(d);
      return d;
    };

    // UI pieces replaced by Arabic replicas (pause-menu tabs): same box and colors as the game's.
    for (const lb of L.labels || []) {
      const h = lb.rect.h * H;
      const tab = mk(
        {
          left: `${lb.rect.x * W}px`,
          top: `${lb.rect.y * H}px`,
          width: `${lb.rect.w * W}px`,
          height: `${h}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: lb.bg,
          color: lb.fg,
          fontFamily: `"${opts.text_font}", ${fonts()}`,
          fontWeight: "500",
          fontSize: `${h * 0.55}px`,
          lineHeight: "1",
          whiteSpace: "nowrap",
          overflow: "hidden",
        },
        `<span>${esc(lb.ar)}</span>`,
      );
      // (a tab's name longer in this language than the game's English, "DIKEHENDAKI & BAHANG": smaller, inside its
      // own tab, not over the next one)
      // (measured again once the language's font has come: a script's fallback font loads on first use, and the name
      // was measured in another, narrower one)
      const name = tab && tab.firstChild;
      const room = lb.rect.w * W * 0.92;
      const fit = () => {
        if (!name || !name.isConnected) return;
        tab.style.fontSize = `${h * 0.55}px`;
        if (name.offsetWidth > room) tab.style.fontSize = `${h * 0.55 * (room / name.offsetWidth)}px`;
      };
      fit();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
      setTimeout(fit, 400);
    }

    // Pause-menu content: list items and paragraphs covered by Arabic replicas (same place and
    // colors as the game's; not yet translated ones stay English).
    for (const m of L.menu || []) {
      if (!m.ar) continue;
      const lh = m.line_h * H;
      // a script's free-form box: its own place, alignment and look
      if (m.align || m.font || m.size || m.weight || m.shadow || m.outline || m.wrap) {
        const fs = lh * (m.size || 1.2);
        const font = m.font === "title" ? opts.title_font : m.font || opts.text_font;
        const wrap = m.wrap ? m.wrap === "yes" : !m.item;
        const align = m.align || (m.right ? "right" : "left");
        mk(
          {
            left: `${m.rect.x * W}px`,
            top: `${m.rect.y * H}px`,
            width: `${m.rect.w * W}px`,
            minHeight: `${m.rect.h * H}px`,
            boxSizing: "border-box",
            padding: m.bg && m.bg !== "transparent" ? `0 ${lh * 0.4}px` : "0",
            display: "flex",
            alignItems: "center",
            justifyContent: align === "center" ? "center" : (align === "right") === rtl() ? "flex-start" : "flex-end",
            textAlign: align,
            whiteSpace: wrap ? "normal" : "nowrap",
            background: m.bg || "transparent",
            color: m.fg || "#ffffff",
            fontFamily: `"${font}", ${fonts()}`,
            fontWeight: String(m.weight || 500),
            fontSize: `${fs}px`,
            lineHeight: "1.35",
            textShadow: m.shadow ? shadow(fs) : "",
            WebkitTextStroke: m.outline ? `${(fs * 0.06).toFixed(1)}px ${m.outline}` : "",
            paintOrder: m.outline ? "stroke fill" : "",
          },
          `<span>${withIcons(m.ar, m.icons)}</span>`,
        );
        continue;
      }
      mk(
        {
          // keep the English's edge: right-aligned values stay right-aligned, lists stay left
          right: m.right ? `${W - (m.rect.x + m.rect.w) * W}px` : "",
          left: m.right ? "" : `${m.rect.x * W}px`,
          top: `${m.rect.y * H}px`,
          minWidth: `${m.rect.w * W}px`,
          minHeight: `${m.rect.h * H}px`,
          // list items stay on one line; panel text may wrap, up to the panel's edge
          // (a paragraph keeps its own width: on the Store a picture sits right next to it)
          maxWidth: m.item ? "none" : (m.lines || 1) > 1 ? `${m.rect.w * W}px` : `${Math.max(m.rect.w * W, (m.right ? m.rect.x + m.rect.w - 0.39 : 0.845 - m.rect.x) * W)}px`,
          boxSizing: "border-box",
          padding: `0 ${lh * 0.5}px`,
          display: "flex",
          alignItems: "center",
          // (in a right-to-left box flex-start is its right side)
          justifyContent: (m.right === rtl()) ? "flex-start" : "flex-end",
          textAlign: m.right ? "right" : "left",
          whiteSpace: m.item ? "nowrap" : "normal",
          background: m.bg,
          color: m.fg,
          fontFamily: `"${opts.text_font}", ${fonts()}`,
          fontWeight: "500",
          fontSize: `${lh * 1.2}px`,
          lineHeight: "1.35",
        },
        // one child: this box is a flex container, and each left-to-right run would become its own column
        `<span>${withIcons(m.ar, m.icons)}</span>`,
      );
    }

    // Pause menu, top right: character name, day and time, in Arabic just left of the English.
    if (L.player && L.player.ar.length) {
      const p = L.player;
      const lh = p.line_h * H;
      mk(
        {
          right: `${W - p.rect.x * W + lh * 0.8}px`,
          top: `${p.rect.y * H - lh * 0.25}px`,
          textAlign: "right",
          // condensed thin sans, like the game's narrow capitals (Noto Sans Arabic, extra-condensed light)
          fontFamily: `"Noto Sans Arabic", ${fonts()}`,
          fontStretch: "62.5%",
          fontWeight: "300",
          fontSize: `${lh * 1.25}px`,
          lineHeight: `${p.pitch * H}px`,
          color: "#ffffff",
          // like the game's: a dark copy of the letters, down and to the right, slightly soft
          textShadow: `${(lh * 0.1).toFixed(1)}px ${(lh * 0.1).toFixed(1)}px ${(lh * 0.08).toFixed(1)}px rgba(0,0,0,0.95)`,
        },
        p.ar.map(esc).join("<br>"),
      );
    }

    // Title: same color and visual height as the English title, centred just above it.
    const th = L.title.h * H;
    const tfs = th * 1.3; // Arabic letters stand ~0.75em tall in display fonts
    if (L.title_ar) mk(
      {
        left: `${(L.title.x + L.title.w / 2) * W}px`,
        top: `${L.title.y * H - th * 0.1}px`,
        transform: "translate(-50%, -100%)",
        fontFamily: `"${opts.title_font}", ${fonts()}`,
        fontWeight: "700",
        fontSize: `${tfs}px`,
        color: L.title_color,
        textShadow: shadow(tfs),
      },
      esc(L.title_ar),
    );

    // Reason: white, same size as the English reason, centred just below it.
    const plainReason = (reasonSegs || []).map((s) => s[0]).join("").trim();
    if (L.reason && plainReason) {
      // Size from ONE line of the English (it may wrap onto several), and wrap the Arabic the same way.
      const rh = (L.reason_line_h || L.reason.h) * H;
      const rfs = rh * 1.35;
      mk(
        {
          left: `${(L.reason.x + L.reason.w / 2) * W}px`,
          top: `${(L.reason.y + L.reason.h) * H + rh * 0.35}px`,
          transform: "translateX(-50%)",
          width: "max-content",
          maxWidth: `${Math.min(Math.max(L.reason.w * 1.1, 0.25) * W, W * 0.9)}px`,
          whiteSpace: "normal",
          textAlign: "center",
          lineHeight: "1.4",
          fontFamily: `"${opts.text_font}", ${fonts()}`,
          fontWeight: "500",
          fontSize: `${rfs}px`,
          color: "#ffffff",
          textShadow: shadow(rfs),
        },
        segHtml(reasonSegs),
      );
    }

    // Buttons that know their icon's place: each one's Arabic label and the game's own icon just above its
    // English one, icon over icon (so they line up with the game's), in the word's color (a greyed-out
    // button stays grey).
    // (an icon too faint to cut out still has its place: the label goes there, without the picture)
    const placed = L.buttons && L.buttons.length && L.buttons.every((b) => b.icon_rect && b.text_rect);
    if (placed) {
      // right to left; a label longer than its English pushes the ones to its left further left
      let room = Infinity; // where the item to the right begins (px from the left)
      const order = L.buttons.slice().sort((a, b) => b.icon_rect.x - a.icon_rect.x);
      // (all on one middle line: a bigger icon, a ringed "RESTORE ALL", grows up and down alike, its word level
      // with the others', not pushed up by the extra height)
      const stdH = Math.min(...order.map((b) => b.icon_rect.h));
      for (const b of order) {
        const capH = b.text_rect.h * H;
        const bfs = capH * 1.45;
        const iconRight = Math.min((b.icon_rect.x + b.icon_rect.w) * W, room - capH * 0.8);
        const extra = (b.icon_rect.h - stdH) * H;
        const item = mk({
          right: `${W - iconRight}px`,
          top: `${b.icon_rect.y * H - capH * 0.35 + extra}px`,
          transform: "translateY(-100%)",
          display: "flex",
          alignItems: "center",
          gap: `${Math.max(2, (b.icon_rect.x - (b.text_rect.x + b.text_rect.w)) * W)}px`,
          // (no picture: keep the icon's room, so the label sits where it would beside it)
          paddingRight: b.icon ? "0" : `${b.icon_rect.w * W + Math.max(2, (b.icon_rect.x - (b.text_rect.x + b.text_rect.w)) * W)}px`,
          fontFamily: `"${opts.text_font}", ${fonts()}`,
          fontWeight: "700",
          fontSize: `${bfs}px`,
          color: b.fg || "#ffffff",
          textShadow: shadow(bfs),
        }, "");
        // (right to left: the icon first, on the right, like the game's after its word)
        for (const src of (b.icon ? [b.icon, ...(b.more_icons || [])] : []).reverse()) {
          const img = document.createElement("img");
          img.src = src;
          // the icon's place, not its picture's own width: a grey icon cuts out narrower than a white one,
          // and a picture not loaded yet has none (the label beside it moved left and right)
          Object.assign(img.style, { height: `${b.icon_rect.h * H}px`, width: `${b.icon_rect.w * W}px`, objectFit: "contain", flex: "none", display: "block" });
          item.appendChild(img);
        }
        const label = document.createElement("span");
        label.textContent = b.ar;
        item.appendChild(label);
        room = iconRight - item.offsetWidth;
      }
    }
    // Buttons: the game's own icons + Arabic labels, a row just above the English one, right-aligned to it.
    if (!placed && L.buttons && L.buttons.length && L.buttons_row) {
      const row = L.buttons_row;
      const capH = Math.min(...L.buttons.map((b) => b.text_rect.h)) * H; // word without descenders
      const bfs = capH * 1.45;
      const iconGap = Math.max(
        2,
        ...L.buttons.filter((b) => b.icon_rect).map((b) => (b.icon_rect.x - (b.text_rect.x + b.text_rect.w)) * W),
      );
      const rowEl = mk({
        right: `${W - (row.x + row.w) * W}px`,
        top: `${row.y * H - row.h * H * 0.35}px`,
        transform: "translateY(-100%)",
        display: "flex",
        alignItems: "center",
        gap: `${row.h * H * 0.9}px`,
        fontFamily: `"${opts.text_font}", ${fonts()}`,
        fontWeight: "500",
        fontSize: `${bfs}px`,
        color: "#ffffff",
      }, "");
      // right to left: first button is the rightmost, its icon on the right like the game
      for (const b of L.buttons) {
        const item = document.createElement("div");
        Object.assign(item.style, { display: "flex", alignItems: "center", gap: `${iconGap}px`, textShadow: shadow(bfs) });
        // icons in the game's left-to-right order ("L1 R1"): this row is right-to-left, so the
        // last icon goes in first (rightmost)
        const icons = b.icon && b.icon_rect ? [b.icon, ...(b.more_icons || [])] : [];
        for (const src of icons.reverse()) {
          const img = document.createElement("img");
          img.src = src;
          Object.assign(img.style, { height: `${b.icon_rect.h * H}px`, width: "auto", display: "block" });
          item.appendChild(img);
        }
        const label = document.createElement("span");
        label.textContent = b.ar;
        item.appendChild(label);
        rowEl.appendChild(item);
      }
    }
  }

  // Font size (CSS px) that matches the game's English text: lineH is a fraction of the frame
  // height, frameH the frame's height in CSS px. Returns 0 when not matching (use the style size).
  function matchedPx(area, lineH, frameH) {
    if (!area || area.match_size === false || !lineH) return 0;
    return lineH * frameH * MATCH_FACTOR * (area.font_scale || 1);
  }

  // GTA's instructions box hugs its text with these margins (in English line heights, measured on
  // captured frames): ~0.65 left/top/bottom, ~1.2 right.
  const BOX_PAD = { left: 0.65, right: 1.2, bottom: 0.65, gap: 0.3 };

  // "Below the game's text box": put `box` right under the game's box — same left edge, at most the
  // same width (long Arabic wraps onto more lines, growing downward).
  // tb: English text block [x, y, w, h] as fractions of the frame; lineH: English line height
  // (fraction); W, H: frame size in CSS px; ox, oy: where the box's container starts (CSS px).
  // Placements that follow the game's own text on screen (from the English text block).
  const atText = (placement) => placement === "under_text" || placement === "above_text";

  // "Just above the game's text": the Arabic's bottom right above the English, centred on it, as
  // wide as the area at most.
  function placeAboveText(box, tb, lineH, W, H, ox, oy, maxW) {
    const lh = (lineH || tb[3]) * H;
    Object.assign(box.style, {
      position: "absolute",
      left: `${(tb[0] + tb[2] / 2) * W - ox}px`,
      top: `${tb[1] * H - BOX_PAD.gap * lh - oy}px`,
      transform: "translate(-50%, -100%)",
      margin: "0",
      width: "max-content",
      maxWidth: `${Math.max(maxW, 60)}px`,
      boxSizing: "border-box",
    });
  }

  // Place `box` at the game's text for these placements. tb: the English text block (fractions of
  // the frame; null when not known: then at the read area's edge). areaW, areaH: the read area's
  // size in CSS px; the box's container starts at the area's top (under_text) or ends at its
  // bottom (above_text).
  // gb: the game's own box around the text when the app found its edges ([x, y, w, h] fractions)
  function placeAtText(box, placement, tb, lineH, W, H, ox, oy, areaW, areaH, gb) {
    if (placement === "under_text") {
      if (gb) placeUnderGameBox(box, gb, lineH || (tb && tb[3]) || 0.03, W, H, ox, oy);
      else if (tb) placeUnderText(box, tb, lineH, W, H, ox, oy);
      else Object.assign(box.style, { position: "absolute", left: "0", top: `${areaH}px`, margin: "0" });
    } else if (tb) {
      placeAboveText(box, tb, lineH, W, H, ox, oy, areaW);
    } else {
      Object.assign(box.style, { position: "absolute", left: "50%", bottom: `${areaH}px`, transform: "translateX(-50%)", margin: "0", width: "max-content", maxWidth: `${Math.max(areaW, 60)}px` });
    }
  }

  // Right under the game's box, with exactly its left and right edges (the text wraps inside).
  function placeUnderGameBox(box, gb, lineH, W, H, ox, oy) {
    const lh = lineH * H;
    Object.assign(box.style, {
      position: "absolute",
      left: `${gb[0] * W - ox}px`,
      top: `${(gb[1] + gb[3]) * H + BOX_PAD.gap * lh - oy}px`,
      margin: "0",
      width: `${Math.max(gb[2] * W, 60)}px`,
      maxWidth: "none",
      boxSizing: "border-box",
    });
  }

  function placeUnderText(box, tb, lineH, W, H, ox, oy) {
    const lh = (lineH || tb[3]) * H;
    const left = tb[0] * W - BOX_PAD.left * lh;
    const right = (tb[0] + tb[2]) * W + BOX_PAD.right * lh;
    const bottom = (tb[1] + tb[3]) * H + BOX_PAD.bottom * lh;
    Object.assign(box.style, {
      position: "absolute",
      left: `${left - ox}px`,
      top: `${bottom + BOX_PAD.gap * lh - oy}px`,
      margin: "0",
      width: "max-content",
      maxWidth: `${Math.max(right - left, 60)}px`,
      boxSizing: "border-box",
    });
  }

  // TEMP (testing the translation memory): color of Arabic that came from the memory

  // An area's text style: its own, else the profile's (areas from before had none of their own).
  const styleOf = (area, base) => (area && area.style) || base;

  return { setLang, styleOf, esc, segHtml, rectFor, alignOf, anchor, renderBox, renderScreen, matchedPx, placeUnderText, atText, placeAtText };
})();
