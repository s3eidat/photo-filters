/* Photo Filters — all pixel work happens in this file on your device (no ctx.filter, so every browser matches). */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  var PREVIEW = 1200, THUMB = 84;
  var DEF = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, hue: 0, fade: 0, grayscale: 0, sepia: 0, blur: 0, sharpen: 0, vignette: 0 };
  var SLIDERS = [
    ["Light", [["brightness", "Brightness", -100, 100], ["contrast", "Contrast", -100, 100], ["fade", "Fade", 0, 100]]],
    ["Colour", [["saturation", "Saturation", -100, 100], ["warmth", "Warmth", -100, 100], ["hue", "Hue", -180, 180], ["grayscale", "Black & white", 0, 100], ["sepia", "Sepia", 0, 100]]],
    ["Detail", [["sharpen", "Sharpen", 0, 100], ["blur", "Blur", 0, 20], ["vignette", "Vignette", 0, 100]]]
  ];
  var PRESETS = [
    ["Original", {}],
    ["Vivid", { contrast: 15, saturation: 35, brightness: 3, sharpen: 20 }],
    ["Warm", { warmth: 45, saturation: 10, contrast: 6 }],
    ["Cool", { warmth: -45, brightness: 3, contrast: 5 }],
    ["Drama", { contrast: 40, saturation: -15, vignette: 50, sharpen: 30 }],
    ["Mono", { grayscale: 100, contrast: 20 }],
    ["Noir", { grayscale: 100, contrast: 50, brightness: -8, vignette: 55 }],
    ["Vintage", { sepia: 55, fade: 35, contrast: -10, vignette: 35 }],
    ["Faded", { fade: 55, saturation: -25, contrast: -12 }],
    ["Soft", { brightness: 8, contrast: -15, fade: 20, blur: 1.5 }],
    ["Sunset", { warmth: 60, hue: -8, saturation: 20, vignette: 30 }]
  ];

  var st = Object.assign({}, DEF), tf = { rot: 0, fh: false, fv: false };
  var lastUrl = null, src = null, srcName = "photo", base = null, comparing = false, fmt = S3.store("pf.fmt") || "jpeg";
  var cv = $("#cv"), ctx = cv.getContext("2d", { willReadFrequently: true });

  // ---------- colour math: one 3x4 affine matrix per edit, composed into one ----------
  function lin(a) { return [a[0], a[1], a[2], 0, a[3], a[4], a[5], 0, a[6], a[7], a[8], 0]; }
  function then(M, N) { // N applied after M
    var o = new Array(12);
    for (var i = 0; i < 3; i++) {
      for (var j = 0; j < 4; j++) {
        var v = j === 3 ? N[i * 4 + 3] : 0;
        for (var k = 0; k < 3; k++) v += N[i * 4 + k] * M[k * 4 + j];
        o[i * 4 + j] = v;
      }
    }
    return o;
  }
  function matrix(s) {
    var M = lin([1, 0, 0, 0, 1, 0, 0, 0, 1]), k;
    if (s.warmth) { k = s.warmth / 100; M = then(M, lin([1 + 0.12 * k, 0, 0, 0, 1 + 0.02 * k, 0, 0, 0, 1 - 0.16 * k])); }
    if (s.brightness) { k = 1 + s.brightness / 100; M = then(M, lin([k, 0, 0, 0, k, 0, 0, 0, k])); }
    if (s.contrast) { k = 1 + s.contrast / 100; var t = 128 * (1 - k); M = then(M, [k, 0, 0, t, 0, k, 0, t, 0, 0, k, t]); }
    if (s.saturation) { k = 1 + s.saturation / 100; M = then(M, lin([0.213 + 0.787 * k, 0.715 - 0.715 * k, 0.072 - 0.072 * k, 0.213 - 0.213 * k, 0.715 + 0.285 * k, 0.072 - 0.072 * k, 0.213 - 0.213 * k, 0.715 - 0.715 * k, 0.072 + 0.928 * k])); }
    if (s.hue) {
      var a = s.hue * Math.PI / 180, c = Math.cos(a), n = Math.sin(a);
      M = then(M, lin([0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928,
        0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.140, 0.072 - c * 0.072 - n * 0.283,
        0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072]));
    }
    if (s.fade) { k = s.fade / 100; var f = 1 - 0.2 * k, o = 34 * k; M = then(M, [f, 0, 0, o, 0, f, 0, o, 0, 0, f, o]); }
    if (s.grayscale) { k = 1 - s.grayscale / 100; M = then(M, lin([0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k, 0.2126 - 0.2126 * k, 0.7152 + 0.2848 * k, 0.0722 - 0.0722 * k, 0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k])); }
    if (s.sepia) { k = 1 - s.sepia / 100; M = then(M, lin([0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k, 0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k, 0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k])); }
    return M;
  }

  // Separable box blur, 3 passes ≈ gaussian. RGB only; alpha untouched. O(pixels) whatever the radius.
  function boxPass(a, b, w, h, r, horiz) {
    var n = horiz ? w : h, lines = horiz ? h : w, step = horiz ? 4 : 4 * w, div = 2 * r + 1;
    for (var L = 0; L < lines; L++) {
      var base0 = horiz ? L * w * 4 : L * 4;
      for (var c = 0; c < 3; c++) {
        var o = base0 + c, sum = 0, i;
        for (i = -r; i <= r; i++) sum += a[o + Math.min(n - 1, Math.max(0, i)) * step];
        for (i = 0; i < n; i++) {
          b[o + i * step] = sum / div;
          sum += a[o + Math.min(n - 1, i + r + 1) * step] - a[o + Math.max(0, i - r) * step];
        }
      }
    }
  }
  function blur(d, w, h, r) {
    r = Math.round(r); if (r < 1) return d;
    var t = new Uint8ClampedArray(d.length);
    for (var p = 0; p < 3; p++) { boxPass(d, t, w, h, r, true); boxPass(t, d, w, h, r, false); }
    return d;
  }

  function process(img, s) {
    var d = img.data, w = img.width, h = img.height, long = Math.max(w, h), i;
    if (s.blur > 0) blur(d, w, h, s.blur * long / 1000);
    if (s.sharpen > 0) {
      var soft = blur(new Uint8ClampedArray(d), w, h, Math.max(1, long / 1000)), amt = s.sharpen / 100 * 1.6;
      for (i = 0; i < d.length; i += 4) {
        d[i] += (d[i] - soft[i]) * amt; d[i + 1] += (d[i + 1] - soft[i + 1]) * amt; d[i + 2] += (d[i + 2] - soft[i + 2]) * amt;
      }
    }
    var M = matrix(s), v = s.vignette / 100, cx = w / 2, cy = h / 2;
    for (var y = 0; y < h; y++) {
      var dy = (y + 0.5 - cy) / cy;
      for (var x = 0; x < w; x++) {
        i = (y * w + x) * 4;
        var r = d[i], g = d[i + 1], b = d[i + 2], m = 1;
        if (v) {
          var dx = (x + 0.5 - cx) / cx, dist = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2, e = Math.min(1, Math.max(0, (dist - 0.3) / 0.7));
          m = 1 - v * 0.85 * e * e * (3 - 2 * e);
        }
        d[i] = (M[0] * r + M[1] * g + M[2] * b + M[3]) * m;
        d[i + 1] = (M[4] * r + M[5] * g + M[6] * b + M[7]) * m;
        d[i + 2] = (M[8] * r + M[9] * g + M[10] * b + M[11]) * m;
      }
    }
    return img;
  }

  // Rotation/flip are screen-relative: flip is applied after rotating.
  function oriented(source, max, t) {
    var sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height;
    var k = Math.min(1, max / Math.max(sw, sh)), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    var c = document.createElement("canvas"), swap = t.rot % 180 !== 0;
    c.width = swap ? h : w; c.height = swap ? w : h;
    var x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingQuality = "high";
    x.translate(c.width / 2, c.height / 2); x.scale(t.fh ? -1 : 1, t.fv ? -1 : 1); x.rotate(t.rot * Math.PI / 180);
    x.drawImage(source, -w / 2, -h / 2, w, h);
    return c;
  }
  function edited(baseCanvas, s) {
    var c = document.createElement("canvas"); c.width = baseCanvas.width; c.height = baseCanvas.height;
    var x = c.getContext("2d");
    var img = baseCanvas.getContext("2d").getImageData(0, 0, c.width, c.height);
    x.putImageData(process(img, s), 0, 0);
    return c;
  }

  // ---------- UI ----------
  var outs = {};
  SLIDERS.forEach(function (g) {
    var box = $("#sliders");
    box.appendChild(S3.h("div", { "class": "pf-group", text: g[0] }));
    g[1].forEach(function (sd) {
      var out = S3.h("span", { "class": "pf-val mono", text: "0" });
      var range = S3.h("input", { type: "range", id: "s-" + sd[0], min: sd[2], max: sd[3], step: sd[0] === "blur" ? "0.5" : "1", value: "0" });
      range.addEventListener("input", function () { st[sd[0]] = +range.value; changed(); });
      range.addEventListener("dblclick", function () { range.value = 0; st[sd[0]] = 0; changed(); });
      outs[sd[0]] = { out: out, range: range };
      box.appendChild(S3.h("label", { "class": "field pf-slider" }, [S3.h("span", { "class": "row between" }, [S3.h("span", { text: sd[1] }), out]), range]));
    });
  });
  function syncSliders() {
    Object.keys(DEF).forEach(function (k) { outs[k].range.value = st[k]; outs[k].out.textContent = (st[k] > 0 && k !== "blur" && outs[k].range.min < 0 ? "+" : "") + st[k]; });
    $$(".pf-preset").forEach(function (b) { b.setAttribute("aria-pressed", String(same(PRESETS[+b.dataset.i][1]))); });
  }
  function same(p) { return Object.keys(DEF).every(function (k) { return (p[k] || 0) === st[k]; }); }

  var queued = false;
  function changed() { syncSliders(); if (!queued && base) { queued = true; requestAnimationFrame(paint); } }
  function paint() {
    queued = false; if (!base) return;
    cv.width = base.width; cv.height = base.height;
    if (comparing) { ctx.drawImage(base, 0, 0); return; }
    var img = base.getContext("2d").getImageData(0, 0, base.width, base.height);
    ctx.putImageData(process(img, st), 0, 0);
  }
  function rebuild() {
    base = oriented(src, PREVIEW, tf);
    var w = src.naturalWidth || src.width, h = src.naturalHeight || src.height, sw = tf.rot % 180 ? h : w, sh = tf.rot % 180 ? w : h;
    $("#meta").textContent = srcName + " · " + sw + " × " + sh + " px";
    paint();
  }
  function thumbs() {
    var tb = oriented(src, THUMB * 2, tf), box = $("#presets");
    box.innerHTML = "";
    PRESETS.forEach(function (p, i) {
      var s = Object.assign({}, DEF, p[1]), c = edited(tb, s);
      var b = S3.h("button", { "class": "pf-preset", "data-i": i, "aria-pressed": "false", title: p[0] }, [c, S3.h("span", { text: p[0] })]);
      b.addEventListener("click", function () { st = Object.assign({}, DEF, p[1]); changed(); });
      box.appendChild(b);
    });
    syncSliders();
  }

  function load(source, name) {
    src = source; srcName = name || "photo"; tf = { rot: 0, fh: false, fv: false }; st = Object.assign({}, DEF);
    $("#drop").hidden = true; $("#editor").hidden = false; $("#export").disabled = false;
    rebuild(); thumbs();
  }
  function openFile(f) {
    var url = URL.createObjectURL(f), img = new Image();
    img.onload = function () { if (lastUrl) URL.revokeObjectURL(lastUrl); lastUrl = url; load(img, f.name.replace(/\.[^.]+$/, "")); };
    img.onerror = function () { URL.revokeObjectURL(url); S3.toast("Couldn't read that image", "error"); };
    img.src = url;
  }
  var input = S3.drop($("#drop"), function (fs) { openFile(fs[0]); }, { accept: "image/*", multiple: false });
  $("#newImg").addEventListener("click", function () { input.click(); });
  document.addEventListener("paste", function (e) {
    var it = Array.prototype.slice.call((e.clipboardData && e.clipboardData.items) || []).filter(function (x) { return x.type.indexOf("image/") === 0; })[0];
    if (it) { e.preventDefault(); var f = it.getAsFile(); if (f) openFile(f); }
  });
  var stage = $("#stage");
  stage.addEventListener("dragover", function (e) { e.preventDefault(); });
  stage.addEventListener("drop", function (e) { e.preventDefault(); var f = e.dataTransfer.files[0]; if (f && /^image\//.test(f.type)) openFile(f); });

  function transform(fn) { if (!src) return; fn(); rebuild(); thumbs(); }
  $("#rotL").addEventListener("click", function () { transform(function () { tf.rot = (tf.rot + 270) % 360; }); });
  $("#rotR").addEventListener("click", function () { transform(function () { tf.rot = (tf.rot + 90) % 360; }); });
  $("#flipH").addEventListener("click", function () { transform(function () { tf.fh = !tf.fh; }); });
  $("#flipV").addEventListener("click", function () { transform(function () { tf.fv = !tf.fv; }); });
  $("#reset").addEventListener("click", function () { st = Object.assign({}, DEF); changed(); });

  function compare(on) { if (comparing === on || !base) return; comparing = on; $("#badge").hidden = !on; $("#compare").classList.toggle("primary", on); paint(); }
  [$("#compare"), cv].forEach(function (el) {
    el.addEventListener("pointerdown", function (e) { e.preventDefault(); compare(true); });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) { el.addEventListener(ev, function () { compare(false); }); });
  });
  cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  $("#compare").addEventListener("keydown", function (e) { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); compare(true); } });
  $("#compare").addEventListener("keyup", function () { compare(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "\\" && !/INPUT|TEXTAREA/.test(e.target.tagName || "")) compare(true); });
  document.addEventListener("keyup", function (e) { if (e.key === "\\") compare(false); });

  function seg(el, value, onPick) {
    $$("button", el).forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.v === value));
      b.addEventListener("click", function () { $$("button", el).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); onPick(b.dataset.v); });
    });
  }
  seg($("#fmt"), fmt, function (v) { fmt = v; S3.store("pf.fmt", v); $("#qWrap").hidden = v === "png"; });
  $("#qWrap").hidden = fmt === "png";
  $("#q").addEventListener("input", function () { $("#qLbl").textContent = this.value; });

  $("#export").addEventListener("click", function () {
    if (!src) return;
    var btn = this; btn.disabled = true; btn.lastChild.textContent = "Exporting…";
    setTimeout(function () { // let the label paint before the heavy work
      try {
        var c = edited(oriented(src, Infinity, tf), st), type = "image/" + fmt;
        c.toBlob(function (b) {
          btn.disabled = false; btn.lastChild.textContent = "Export full resolution";
          if (!b) { S3.toast("This photo is too large for your browser to encode", "error"); return; }
          S3.download(b, srcName + "-edited." + (fmt === "jpeg" ? "jpg" : "png"));
          $("#exportInfo").textContent = "Saved " + c.width + " × " + c.height + " px, " + S3.fmtBytes(b.size) + ". Metadata (EXIF, GPS) is not copied.";
          S3.done();
        }, type, fmt === "jpeg" ? +$("#q").value / 100 : undefined);
      } catch (e) {
        btn.disabled = false; btn.lastChild.textContent = "Export full resolution";
        S3.toast("Export failed: " + e.message, "error");
      }
    }, 30);
  });
  syncSliders();

  // ---------- sample photo, drawn locally ----------
  function sample() {
    var c = document.createElement("canvas"); c.width = 1200; c.height = 800;
    var x = c.getContext("2d"), g = x.createLinearGradient(0, 0, 0, 520);
    g.addColorStop(0, "#2b4c7e"); g.addColorStop(0.55, "#e9a06b"); g.addColorStop(1, "#f6d29a");
    x.fillStyle = g; x.fillRect(0, 0, 1200, 520);
    var sun = x.createRadialGradient(780, 430, 10, 780, 430, 140);
    sun.addColorStop(0, "rgba(255,244,214,1)"); sun.addColorStop(0.35, "rgba(255,214,150,.9)"); sun.addColorStop(1, "rgba(255,190,120,0)");
    x.fillStyle = sun; x.fillRect(560, 250, 440, 340);
    function ridge(y0, amp, col, seed) {
      x.fillStyle = col; x.beginPath(); x.moveTo(0, 800);
      for (var i = 0; i <= 1200; i += 20) x.lineTo(i, y0 - amp * (Math.sin(i / 140 + seed) * 0.6 + Math.sin(i / 53 + seed * 2) * 0.25 + Math.sin(i / 23) * 0.08));
      x.lineTo(1200, 800); x.fill();
    }
    ridge(470, 70, "#6b5b7b", 1); ridge(510, 50, "#4a3f5e", 3);
    var sea = x.createLinearGradient(0, 520, 0, 800);
    sea.addColorStop(0, "#c98a6a"); sea.addColorStop(1, "#2a3550");
    x.fillStyle = sea; x.fillRect(0, 540, 1200, 260);
    x.fillStyle = "rgba(255,230,190,.55)";
    for (var j = 0; j < 22; j++) x.fillRect(700 + Math.sin(j * 1.7) * 30 + j * 2, 552 + j * 11, 160 - j * 5 + Math.cos(j) * 20, 4);
    x.fillStyle = "#231f2e"; x.beginPath(); x.moveTo(0, 800); x.lineTo(0, 610);
    x.bezierCurveTo(160, 600, 260, 650, 420, 700); x.bezierCurveTo(520, 735, 560, 780, 600, 800); x.fill();
    return c;
  }

  window.S3_DEMO = function () { load(sample(), "sample"); st = Object.assign({}, DEF, PRESETS[1][1]); changed(); };

  window.S3_SELFTEST = function () {
    function px(rgb, s) {
      var img = new ImageData(new Uint8ClampedArray([rgb[0], rgb[1], rgb[2], 255]), 1, 1);
      var d = process(img, Object.assign({}, DEF, s)).data; return [d[0], d[1], d[2]];
    }
    function eq(a, b, tol) { return a.every(function (v, i) { return Math.abs(v - b[i]) <= (tol || 0); }); }
    // uniform image stays uniform under blur; a single bright pixel spreads but keeps its energy
    var u = new Uint8ClampedArray(5 * 5 * 4).fill(100), uni = blur(u, 5, 5, 2).every(function (v, i) { return i % 4 === 3 || v === 100; });
    var dot = new Uint8ClampedArray(9 * 9 * 4); dot[(4 * 9 + 4) * 4] = 255; blur(dot, 9, 9, 1);
    var sum = 0; for (var i = 0; i < dot.length; i += 4) sum += dot[i];
    // rotate 90° clockwise: source top-left lands top-right
    var c = document.createElement("canvas"); c.width = 3; c.height = 2;
    var x = c.getContext("2d"); x.fillStyle = "#000"; x.fillRect(0, 0, 3, 2); x.fillStyle = "#f00"; x.fillRect(0, 0, 1, 1);
    var r = oriented(c, Infinity, { rot: 90, fh: false, fv: false }), rp = r.getContext("2d").getImageData(1, 0, 1, 1).data;
    var f = oriented(c, Infinity, { rot: 0, fh: true, fv: false }), fp = f.getContext("2d").getImageData(2, 0, 1, 1).data;
    var vig = new ImageData(new Uint8ClampedArray(11 * 11 * 4).fill(200), 11, 11); process(vig, Object.assign({}, DEF, { vignette: 100 }));
    return eq(px([12, 200, 77], {}), [12, 200, 77]) &&
      eq(px([255, 0, 0], { grayscale: 100 }), [54, 54, 54]) &&
      eq(px([100, 50, 0], { brightness: 100 }), [200, 100, 0]) &&
      eq(px([200, 100, 50], { contrast: -100 }), [128, 128, 128]) &&
      eq(px([40, 160, 220], { hue: 360 }), [40, 160, 220], 1) &&
      eq(px([255, 255, 255], { sepia: 100 }), [255, 255, 239]) &&
      eq(px([90, 60, 30], { saturation: -100 }), px([90, 60, 30], { grayscale: 100 }), 2) &&
      uni && Math.abs(sum - 255) <= 9 && dot[(4 * 9 + 4) * 4] < 255 &&
      r.width === 2 && r.height === 3 && rp[0] === 255 && fp[0] === 255 &&
      vig.data[(5 * 11 + 5) * 4] === 200 && vig.data[0] < 60;
  };
})();
