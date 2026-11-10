/* ==========================================================
   2026年常规保障工作数据舱
   原生 JS · 无构建 · 本地 ECharts
   ========================================================== */
(function () {
  'use strict';

  var DESIGN_W = 1920;
  var DESIGN_H = 1080;
  var PALETTE = ['#22d3ee', '#3b82f6', '#a78bfa', '#fbbf24', '#34d399', '#38bdf8', '#f472b6', '#2dd4bf'];

  /* 分组深浅蓝三档（与 css/style.css 的 .tone-1/2/3 保持同步）
     档 1 深 → 档 3 浅；相邻容器由 JSON 里的 tone 字段错开，便于视觉快速定位。
     ca/cb 为卡片底色，比容器底色亮一档，保证卡片不被容器"吃掉"。 */
  var TONE = {
    1: { a: '#050d18', b: '#040a13', line: 'rgba(38,90,150,.26)', in: 'rgba(0,5,12,.50)', ca: '#0a1826', cb: '#07121e', ca2: '#14324d', line2: 'rgba(44,102,158,.30)' },
    2: { a: '#071829', b: '#05121f', line: 'rgba(62,138,208,.38)', in: 'rgba(10,40,76,.32)', ca: '#0d2846', cb: '#091d33', ca2: '#163d63', line2: 'rgba(66,146,220,.40)' },
    3: { a: '#0d2740', b: '#0a1d31', line: 'rgba(88,176,240,.52)', in: 'rgba(20,62,106,.36)', ca: '#16456f', cb: '#103453', ca2: '#1c5180', line2: 'rgba(94,182,244,.54)' }
  };

  var CFG = null;
  var stage, layer, charts = [], rankLoops = [], clockTimer = null;
  var currentCard = null;
  var dwChart = null;

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function num(v) {
    if (typeof v === 'number') return v;
    if (v == null) return 0;
    var n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  function fmt(v) {
    var n = num(v);
    if (!Number.isInteger(n)) return n.toFixed(1);
    if (Math.abs(n) < 100000) return n.toLocaleString('en-US');
    return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* 把 #rrggbb / #rgb 转成 "r,g,b"，供 CSS 的 rgba(var(--x-rgb), α) 使用。
     用三元组而不是 color-mix()，是为了兼容 WPS 宏编辑器等低版本 Chromium 内核。 */
  function rgbTriple(hex) {
    var h = String(hex || '#38bdf8').replace('#', '').trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return '56,189,248';
    return parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16);
  }

  /* ---------------- 等比缩放 ---------------- */
  var curScale = 1;
  function fitStage() {
    var s = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
    curScale = s;
    stage.style.transform = 'scale(' + s + ')';
  }

  /* ---------------- 流式栅格换算 ----------------
     整体是 4 列等高流式布局：每列是一条 flex 竖列，组按 fr 权重分配列高，
     组内部再用自己的 local.cols × local.rows 嵌套栅格切卡片。
     这样可以保证「十组 16:9 满屏铺满、无空隙」而不必手工凑绝对坐标。 */
  function colMetrics() {
    var g = CFG.grid || { cols: 4, gap: 10 };
    var W = layer.clientWidth || 1880;
    var gap = g.gap;
    return { gap: gap, cols: g.cols, cw: (W - gap * (g.cols - 1)) / g.cols };
  }
  function localCell(x, y, w, h, box, grid, gap, inset) {
    var i = inset || 0;
    var cw = (box.width - gap * (grid.cols - 1)) / grid.cols;
    var ch = (box.height - gap * (grid.rows - 1)) / grid.rows;
    return {
      left: x * (cw + gap) + i,
      top: y * (ch + gap) + i,
      width: w * cw + (w - 1) * gap - i * 2,
      height: h * ch + (h - 1) * gap - i * 2
    };
  }

  /* ---------------- 数据装载 ---------------- */
  function loadConfig() {
    return new Promise(function (resolve) {
      var url = 'data/dashboard.json?t=' + Date.now();
      if (typeof fetch !== 'function') { resolve(withFlag(window.FALLBACK_CONFIG, '内置兜底')); return; }
      fetch(url, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          if (!j || !j.groups || !j.groups.length) throw new Error('数据结构异常');
          resolve(withFlag(j, '本地 JSON'));
        })
        .catch(function () {
          resolve(withFlag(window.FALLBACK_CONFIG, '内置兜底'));
        });
    });
  }
  function withFlag(cfg, flag) {
    if (!cfg) return null;
    cfg.__source = flag;
    return cfg;
  }

  /* ---------------- 顶部 ---------------- */
  function paintHeader() {
    var meta = CFG.meta || {};
    if (meta.title) $('mainTitle').textContent = meta.title;
    if (meta.subtitle) $('subTitle').textContent = meta.subtitle;

    var bs = $('badgeSource');
    bs.querySelector('em').textContent = '数据源';
    bs.querySelector('b').textContent = meta.source ? meta.source : '--';
    bs.title = '配置文件：data/dashboard.json（' + CFG.__source + '）';

    var bp = $('badgeScope');
    bp.querySelector('b').textContent = meta.scope || '--';

    $('updated').textContent = meta.updated || '--';
    $('stageFoot').innerHTML =
      '<span>' + esc(meta.source || '') + ' · 数据口径 ' + esc(meta.scope || '') +
      ' · 版本 ' + esc(meta.version || 'v1.0') + '</span>' +
      '<span>24×14 GRID · GAP 8PX · ECHARTS LOCAL · ' + esc(CFG.__source) + '</span>';

    tickClock();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(tickClock, 1000);
  }

  function tickClock() {
    var d = new Date();
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    var wk = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    $('clock').textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    $('today').textContent = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + wk;
  }

  /* ---------------- 渲染主流程 ---------------- */
  function render() {
    var cm = colMetrics();
    var gap = cm.gap;

    /* 先按 col 分组，同列的组按顺序叠放 */
    var cols = {};
    CFG.groups.forEach(function (g) {
      var c = g.col || 1;
      (cols[c] = cols[c] || []).push(g);
    });

    var fragCol = document.createDocumentFragment();
    Object.keys(cols).forEach(function (key) {
      var ci = parseInt(key, 10);
      var box = document.createElement('div');
      box.className = 'col';
      box.style.left = ((ci - 1) * (cm.cw + gap)) + 'px';
      box.style.top = '0px';
      box.style.width = cm.cw + 'px';
      box.style.height = '100%';
      box.style.gap = gap + 'px';

      cols[key].forEach(function (g) {
        box.appendChild(buildGroup(g, gap));
      });
      fragCol.appendChild(box);
    });

    layer.appendChild(fragCol);

    /* 布局完成后量测真实尺寸，再挂卡片与 widget */
    requestAnimationFrame(function () {
      CFG.groups.forEach(function (g) { layoutGroup(g, gap); });

      requestAnimationFrame(function () {
        CFG.groups.forEach(function (g) {
          g.cards.forEach(function (card) { mountWidget(card); });
        });
        /* 入场动画 */
        var i = 0;
        Array.prototype.forEach.call(layer.querySelectorAll('.card'), function (el) {
          var d = i++ * 20;
          setTimeout(function () { el.classList.add('in'); }, d);
        });
        Array.prototype.forEach.call(layer.querySelectorAll('.group'), function (el, k) {
          setTimeout(function () { el.classList.add('in'); }, k * 30);
        });
      });
    });
  }

  /* 构建一个分组外壳：通栏标题条 + 内容区（内容区留空，稍后按实测尺寸定位卡片） */
  function buildGroup(g, gap) {
    var acc = g.accent || '#38bdf8';
    var frame = document.createElement('section');
    frame.className = 'group tone-' + (g.tone || 1);
    frame.style.setProperty('--glow', acc);
    frame.style.setProperty('--glow-rgb', rgbTriple(acc));
    frame.style.flexGrow = g.fr || 1;
    frame.style.flexShrink = '1';
    frame.style.flexBasis = '0px';

    var head = document.createElement('div');
    head.className = 'g-head tone-' + (g.tone || 1);
    head.style.setProperty('--glow', acc);
    head.style.setProperty('--glow-rgb', rgbTriple(acc));
    head.innerHTML =
      '<em class="g-gloss"></em>' +
      '<span class="g-code">' + esc(g.code) + '</span>' +
      '<span class="g-name">' + esc(g.name) + '</span>' +
      '<span class="g-sub">' + esc(g.en || '') + '</span>' +
      '<span class="g-spacer"></span>' +
      (g.tag ? '<span class="g-tag">' + esc(g.tag) + '</span>' : '');

    var body = document.createElement('div');
    body.className = 'g-body';

    frame.appendChild(head);
    frame.appendChild(body);
    g.__el = frame;
    g.__head = head;
    g.__body = body;
    return frame;
  }

  /* 按分组内容的实测尺寸，用局部栅格排卡片 */
  function layoutGroup(g, gap) {
    var body = g.__body;
    var grid = g.local || { cols: 6, rows: 6 };
    var box = { width: body.clientWidth, height: body.clientHeight };
    if (!box.width || !box.height) return;

    g.cards.forEach(function (card) {
      if (card.__el) card.__el.remove();

      var el = document.createElement('article');
      el.className = 'card';
      el.dataset.id = card.id;
      el.dataset.widget = card.widget;
      el.style.setProperty('--card-accent', g.accent || PALETTE[0]);
      el.style.setProperty('--card-rgb', rgbTriple(g.accent || PALETTE[0]));
      el.style.setProperty('--gt-a', TONE[g.tone || 1].a);
      el.style.setProperty('--gt-b', TONE[g.tone || 1].b);
      el.style.setProperty('--gt-line', TONE[g.tone || 1].line);
      el.style.setProperty('--gt-in', TONE[g.tone || 1].in);
      el.style.setProperty('--gt-ca', TONE[g.tone || 1].ca);
      el.style.setProperty('--gt-cb', TONE[g.tone || 1].cb);
      el.style.setProperty('--gt-ca2', TONE[g.tone || 1].ca2);
      el.style.setProperty('--gt-line2', TONE[g.tone || 1].line2);

      var b = localCell(card.x, card.y, card.w, card.h, box, grid, gap, 0);
      el.style.left = b.left + 'px';
      el.style.top = b.top + 'px';
      el.style.width = b.width + 'px';
      el.style.height = b.height + 'px';

      el.innerHTML =
        '<div class="c-head">' +
          '<div style="min-width:0">' +
            '<div class="c-title"><span>' + esc(card.title) + '</span></div>' +
            (card.sub ? '<div class="c-sub">' + esc(card.sub) + '</div>' : '') +
          '</div>' +
          (card.badge ? '<span class="c-badge">' + esc(card.badge) + '</span>' : '') +
        '</div>' +
        '<div class="c-body"></div>';

      el.addEventListener('click', function () { openDrawer(card); });
      body.appendChild(el);
      card.__el = el;
      card.__group = g;
      if (b.width < 200) el.classList.add('small');
      if (b.height < 110) el.classList.add('short');
    });
  }

  function mountWidget(card) {
    var body = card.__el.querySelector('.c-body');
    var ds = (CFG.datasets || {})[card.datasetId] || { kind: 'table', columns: ['项目', '数值'], rows: [] };
    card.__ds = ds;

    switch (card.widget) {
      case 'kpi': renderKPI(body, card, ds); break;
      case 'ring': renderRing(body, card, ds); break;
      case 'rank': renderRank(body, card, ds); break;
      case 'progress': renderProgress(body, card, ds); break;
      case 'pie': renderEChart(body, card, ds, 'pie'); break;
      case 'bar': renderEChart(body, card, ds, 'bar'); break;
      case 'barH': renderEChart(body, card, ds, 'barH'); break;
      case 'line': renderEChart(body, card, ds, 'line'); break;
      default: renderKPI(body, card, ds);
    }
  }

  /* ---------------- KPI ---------------- */
  function renderKPI(body, card, ds) {
    var unit = ds.unit || '';
    var delta = ds.delta || '';
    var up = ds.trendUp !== false;
    var bh = body.clientHeight;
    var bw = body.clientWidth;
    /* 有趋势数据且宽度够，就右侧带趋势线；很矮的卡片用小号趋势带 */
    var hasTrend = ds.trend && ds.trend.length && bw >= 190 && bh >= 40;
    var tall = bh >= 108;

    var wrap = document.createElement('div');
    wrap.className = 'kpi' +
      (hasTrend ? ' has-spark' : '') +
      (tall ? ' tall' : '') +
      (bh < 58 ? ' mini' : '');

    wrap.innerHTML =
      '<div class="kpi-main">' +
        '<div class="kpi-val">' +
          '<span class="kpi-num">' + esc(fmt(ds.value)) + '</span>' +
          (unit ? '<span class="kpi-unit">' + esc(unit) + '</span>' : '') +
        '</div>' +
        '<div class="kpi-foot">' +
          (delta ? '<span class="kpi-delta' + (up ? '' : ' down') + '">' + (up ? '▲' : '▼') + ' ' + esc(delta) + '</span>' : '') +
          '<span class="kpi-label">' + esc(ds.short || ds.label || '') + '</span>' +
        '</div>' +
      '</div>' +
      (hasTrend ? '<div class="kpi-spark"></div>' : '');

    body.appendChild(wrap);
    autosizeKPI(wrap, card, ds, bh);

    if (hasTrend) {
      var sp = wrap.querySelector('.kpi-spark');
      var ch = echarts.init(sp, null, { renderer: 'canvas', devicePixelRatio: dpr() });
      ch.setOption({
        animationDuration: 900,
        grid: { left: 2, right: 2, top: 4, bottom: 0 },
        xAxis: { type: 'category', show: false, boundaryGap: false, data: ds.trend.map(function (_, i) { return i; }) },
        yAxis: { type: 'value', show: false, min: function (v) { return v.min * 0.92; } },
        series: [{
          type: 'line', data: ds.trend, smooth: true, symbol: 'none',
          lineStyle: { width: 1.3, color: card.__group.accent || '#38bdf8', opacity: .8 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: hexA(card.__group.accent || '#38bdf8', .32) },
              { offset: 1, color: hexA(card.__group.accent || '#38bdf8', 0) }
            ])
          }
        }]
      });
      track(ch, sp);
    }
  }

  /* 数字字号按「内容区实际可用高度」推算，避免矮卡片里数字压住下面的标签 */
  function autosizeKPI(wrap, card, ds, bh) {
    var node = wrap.querySelector('.kpi-num');
    if (!node) return;
    var bodyW = wrap.clientWidth || (card.__el.clientWidth - 22);
    var len = String(fmt(ds.value)).length;
    var footH = 16;                    /* foot 一行占位 */
    var room = bh - footH - 6;         /* 留给数字的净高度 */
    var base = Math.max(15, Math.min(42, room * 0.86));
    var size = base;
    if (len >= 6) size = base * 0.66;
    else if (len >= 5) size = base * 0.8;
    else if (len >= 4) size = base * 0.9;
    /* 再按可用宽度兜底 */
    var est = len * size * 0.62 + 30;
    if (est > bodyW) size = Math.max(14, size * (bodyW / est));
    node.style.fontSize = size.toFixed(1) + 'px';
  }

  function hexA(hex, a) {
    var h = (hex || '#38bdf8').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  /* ---------------- 环形完成率 ---------------- */
  function renderRing(body, card, ds) {
    var val = num(ds.value);
    var total = num(ds.total) || 100;
    var pct = Math.max(0, Math.min(100, (val / total) * 100));
    var acc = card.__group.accent || '#38bdf8';

    var numTxt = String(fmt(ds.value)) + (ds.unit || '');
    var emTxt = String(ds.label || '');

    var box = document.createElement('div');
    box.className = 'ring-wrap';

    var holder = document.createElement('div');
    holder.className = 'chart';
    box.appendChild(holder);

    var center = document.createElement('div');
    center.className = 'ring-center';
    center.innerHTML = '<b>' + esc(fmt(ds.value)) + (ds.unit ? '<i>' + esc(ds.unit) + '</i>' : '') + '</b>' +
      (emTxt ? '<em>' + esc(emTxt) + '</em>' : '');
    box.appendChild(center);
    body.appendChild(box);

    /* 先按容器尺寸判断用哪种排布：
       center —— 环大、文字叠在环心（默认，视觉最强）
       side   —— 环小/矮，文字移到环右侧，字号可用正常大小，不至于缩成 8px */
    var bw = box.clientWidth || 120;
    var bh = box.clientHeight || 96;
    var innerPct = 62;
    var short = Math.min(bw, bh);

    /* 叠心模式下内圆能给出的字号，<10.5px 就说明环太小，改用侧排 */
    var centerInnerD = short * (innerPct / 100);
    var centerFs = Math.min(
      (centerInnerD * 0.82) / Math.max(3, numTxt.length) / 0.62,
      centerInnerD * 0.44
    );
    var side = centerInnerD < 46 || centerFs < 10.5 || bw < 118;

    var ch = echarts.init(holder, null, { renderer: 'canvas', devicePixelRatio: dpr() });

    if (side) {
      /* ---- 侧排：环形靠左固定为短边尺寸，文字块在右侧 ---- */
      var ringS = Math.max(34, Math.min(bh, Math.round(bw * 0.52), 78));
      box.style.gap = '8px';
      box.style.justifyContent = 'center';
      holder.style.flex = '0 0 ' + ringS + 'px';
      holder.style.width = ringS + 'px';
      holder.style.height = ringS + 'px';

      center.style.position = 'relative';
      center.style.inset = 'auto';
      center.style.width = 'auto';
      center.style.maxWidth = 'none';
      center.style.transform = 'none';
      center.style.padding = '0';
      center.style.alignItems = 'flex-start';
      center.style.textAlign = 'left';
      center.style.flex = '1 1 auto';
      center.style.minWidth = '0';
      center.style.gap = '0';
      center.classList.add('side');

      var room = Math.max(30, bw - ringS - 8);
      var sNum = Math.min(
        (room * 0.96) / Math.max(3, numTxt.length) / 0.62,
        bh * 0.42
      );
      sNum = Math.max(11, Math.min(24, sNum));

      var numEl0 = center.querySelector('b');
      var emEl0 = center.querySelector('em');
      numEl0.style.fontSize = sNum + 'px';
      numEl0.style.lineHeight = (sNum * 1.05) + 'px';
      if (numEl0.querySelector('i')) {
        numEl0.querySelector('i').style.fontSize = (sNum * 0.5) + 'px';
      }
      if (emEl0) {
        /* 标签字号按剩余宽度反推，保证整行不折行也不省略 */
        var roomTxt = Math.max(24, room - 2);
        var sEm = Math.min(11, sNum * 0.5, roomTxt / Math.max(3, emTxt.length));
        var showEm0 = emTxt && sEm >= 7.6;
        emEl0.style.fontSize = Math.max(7.6, sEm) + 'px';
        emEl0.style.lineHeight = (Math.max(7.6, sEm) * 1.34) + 'px';
        emEl0.style.display = showEm0 ? '' : 'none';
      }

      ch.setOption({
        animationDuration: 1100, animationEasing: 'cubicOut',
        series: [{
          type: 'pie', radius: ['62%', '92%'], silent: true, center: ['50%', '50%'],
          startAngle: 90, avoidLabelOverlap: false,
          label: { show: false }, labelLine: { show: false },
          data: [
            {
              value: pct,
              itemStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 1, 1, [
                  { offset: 0, color: acc }, { offset: 1, color: hexA(acc, .3) }
                ]),
                shadowBlur: 10, shadowColor: hexA(acc, .5), borderRadius: 4
              }
            },
            { value: 100 - pct, itemStyle: { color: 'rgba(60,130,200,.13)' } }
          ]
        }]
      });
      track(ch, holder);
      return;
    }

    /* ---- 叠心：环形铺满容器，中心文字严格收在内圆中 ---- */
    box.style.justifyContent = 'center';
    box.style.position = 'relative';
    holder.style.width = '100%';
    holder.style.height = '100%';

    var s0 = short;
    var innerD = s0 * (innerPct / 100);
    var fsByW = (innerD * 0.84) / Math.max(3, numTxt.length) / 0.6;
    var fsByH = innerD * 0.46;
    var fs = Math.max(11, Math.min(28, Math.min(fsByW, fsByH)));

    /* 标签行必须窄于内圆，否则整行隐藏，避免压到环上 */
    var emFs = Math.min(fs * 0.46, (innerD * 0.88) / Math.max(3, emTxt.length));
    var showEm = !!emTxt && emFs >= 7 && innerD >= 46;

    var numEl = center.querySelector('b');
    var emEl = center.querySelector('em');
    numEl.style.fontSize = fs + 'px';
    numEl.style.lineHeight = (fs * 1.06) + 'px';
    if (numEl.querySelector('i')) {
      numEl.querySelector('i').style.fontSize = (fs * 0.5) + 'px';
    }
    if (emEl) {
      emEl.style.fontSize = Math.max(7, emFs) + 'px';
      emEl.style.lineHeight = (Math.max(7, emFs) * 1.32) + 'px';
      emEl.style.display = showEm ? '' : 'none';
    }
    center.style.gap = showEm ? '1px' : '0';
    /* inset:0 + maxWidth 会让绝对定位盒子贴左，必须显式居中到环心 */
    center.style.left = '50%';
    center.style.right = 'auto';
    center.style.top = '0';
    center.style.bottom = '0';
    center.style.width = innerD + 'px';
    center.style.maxWidth = innerD + 'px';
    center.style.transform = 'translateX(-50%)';
    center.style.padding = '0 1px';

    ch.setOption({
      animationDuration: 1100,
      animationEasing: 'cubicOut',
      series: [
        {
          type: 'pie', radius: ['94%', '97%'], silent: true, center: ['50%', '50%'],
          label: { show: false }, labelLine: { show: false },
          data: [{ value: 100, itemStyle: { color: 'rgba(80,170,255,.1)' } }]
        },
        {
          type: 'pie', radius: [innerPct + '%', '88%'], silent: true, center: ['50%', '50%'],
          startAngle: 90, avoidLabelOverlap: false,
          label: { show: false }, labelLine: { show: false },
          data: [
            {
              value: pct,
              itemStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 1, 1, [
                  { offset: 0, color: acc },
                  { offset: 1, color: hexA(acc, .3) }
                ]),
                shadowBlur: 12, shadowColor: hexA(acc, .5),
                borderRadius: 5
              }
            },
            { value: 100 - pct, itemStyle: { color: 'rgba(60,130,200,.13)' } }
          ]
        }
      ]
    });
    track(ch, holder);
  }

  /* ---------------- 榜单（自动轮播） ---------------- */
  function renderRank(body, card, ds) {
    var rows = (ds.rows || []).slice();
    var max = rows.reduce(function (a, r) { return Math.max(a, num(r[1])); }, 0) || 1;
    var acc = card.__group.accent || '#38bdf8';

    var box = document.createElement('div');
    box.className = 'rank';
    box.innerHTML = '<div class="rank-list"></div>';
    body.appendChild(box);
    var list = box.querySelector('.rank-list');

    /* 行高按容器高度自适应：先按 20px 一格估算能放几行，再反推行高。
       底部预留 12px 给渐隐遮罩，避免最后一行被吃掉一半。 */
    function computeRows() {
      var bh = box.clientHeight;
      var f = Math.max(2, Math.floor(bh / 20));
      /* 行数放得下 → 均分整高；放不下 → 用能完整铺满的行高（不留半个文字） */
      if (rows.length <= f) {
        return { fit: rows.length, rowH: Math.floor(bh / rows.length), scroll: false };
      }
      f = Math.min(rows.length - 1, f);
      return { fit: f, rowH: Math.floor(bh / f), scroll: true };
    }

    var calc = computeRows();
    var rowH = calc.rowH;
    var nameFs = rowH >= 30 ? 12 : (rowH >= 25 ? 11.5 : (rowH >= 21 ? 10.5 : 9.5));
    var numFs = rowH >= 30 ? 12 : (rowH >= 25 ? 11 : (rowH >= 21 ? 10 : 9));
    box.style.setProperty('--rowh', rowH + 'px');
    box.style.setProperty('--namefs', nameFs + 'px');
    box.style.setProperty('--numfs', numFs + 'px');

    function compact(v) {
      if (Math.abs(v) >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + 'w';
      if (!Number.isInteger(v)) return v.toFixed(1);
      return v.toLocaleString('en-US');
    }

    /* 宽度不够时优先保名称：窄卡隐藏进度条，更窄时数值也缩到 3 字符内 */
    var bw0 = box.clientWidth || 200;
    var needBar = bw0 >= 210;
    var tight = bw0 < 175;
    box.classList.toggle('no-bar', !needBar);
    box.classList.toggle('tight', tight);

    function rowHTML(r, i) {
      var p = Math.max(6, (num(r[1]) / max) * 100);
      return '<div class="rank-item">' +
        '<span class="rank-no">' + (i + 1) + '</span>' +
        '<span class="rank-name" title="' + esc(r[0]) + '">' + esc(r[0]) + '</span>' +
        (needBar ? '<span class="rank-bar"><i style="width:' + p + '%;background:linear-gradient(90deg,' + hexA(acc, .28) + ',' + acc + ')"></i></span>' : '') +
        '<span class="rank-val">' + esc(compact(num(r[1]))) + '</span>' +
        '</div>';
    }

    list.innerHTML = rows.map(rowHTML).join('');

    requestAnimationFrame(function () {
      /* 这里重新量一次：入场动画/布局已经稳定，boxH 才是真实可用高度 */
      var rc = computeRows();
      var h = rc.rowH;
      if (h !== rowH) {
        rowH = h;
        var nf = rowH >= 30 ? 12 : (rowH >= 25 ? 11.5 : (rowH >= 21 ? 10.5 : 9.5));
        var uf = rowH >= 30 ? 12 : (rowH >= 25 ? 11 : (rowH >= 21 ? 10 : 9));
        box.style.setProperty('--rowh', rowH + 'px');
        box.style.setProperty('--namefs', nf + 'px');
        box.style.setProperty('--numfs', uf + 'px');
        list.innerHTML = rows.map(rowHTML).join('');
      }

      var oneH = rows.length * rowH;
      /* 全部行都能放下 → 静止铺满展示（不加渐隐，避免遮住最后一行） */
      if (oneH <= box.clientHeight + 1) return;
      box.classList.add('scroll');

      /* 溢出时按「整行」步进轮播：每次上移一行，停顿后再动，避免半行裁切 */
      var html = rows.map(rowHTML).join('');
      list.innerHTML = html + html;
      var idx = 0;
      var timer = null;
      var stopped = false;

      list.style.transition = 'transform .62s cubic-bezier(.3,.7,.3,1)';

      function step() {
        if (stopped) return;
        idx++;
        list.style.transform = 'translate3d(0,' + (-idx * rowH) + 'px,0)';
        if (idx >= rows.length) {
          /* 播完一轮后瞬时归零，形成无缝循环 */
          setTimeout(function () {
            if (stopped) return;
            list.style.transition = 'none';
            idx = 0;
            list.style.transform = 'translate3d(0,0,0)';
            void list.offsetHeight;
            list.style.transition = 'transform .62s cubic-bezier(.3,.7,.3,1)';
          }, 640);
        }
      }

      function loop() {
        step();
        timer = setTimeout(loop, 2400);
      }
      timer = setTimeout(loop, 1800);
      rankLoops.push({ stop: function () { stopped = true; clearTimeout(timer); } });

      box.addEventListener('mouseenter', function () {
        stopped = true; clearTimeout(timer);
      });
      box.addEventListener('mouseleave', function () {
        if (stopped) { stopped = false; timer = setTimeout(loop, 900); }
      });
    });
  }

  /* ---------------- 横向进度（完成率对比） ---------------- */
  function renderProgress(body, card, ds) {
    var rows = ds.rows || [];
    var wrap = document.createElement('div');
    wrap.className = 'prog';

    var n = Math.max(1, rows.length);
    wrap.style.gridTemplateRows = 'repeat(' + n + ', minmax(0,1fr))';

    var avail = (body.clientHeight || 90) - 2;
    var rowH = avail / n;
    var tiny = rowH < 22;
    var compact = rowH < 30;
    var labelFs = tiny ? 8.5 : (compact ? 9.5 : 10.5);
    var trackH = tiny ? 4 : (compact ? 5 : 6);
    wrap.style.gap = tiny ? '1px' : (compact ? '3px' : '4px');
    /* 每行需要的最小高度 = 文字行高 + 轨道 + 行内间隙；不够就压行高，避免末行轨道被裁 */
    var labelH = Math.ceil(labelFs * 1.35);
    var need = labelH + trackH + 2;
    if (rowH < need) {
      trackH = Math.max(3, Math.round(rowH - labelH - 1));
      if (trackH < 3) {
        labelFs = Math.max(7.2, labelFs - 0.8);
        labelH = Math.ceil(labelFs * 1.3);
        trackH = Math.max(3, Math.round(rowH - labelH - 0.5));
      }
    }
    wrap.style.alignContent = 'stretch';

    wrap.innerHTML = rows.map(function (r, i) {
      var done = num(r[1]), target = num(r[2]) || 100;
      var pct = Math.max(0, Math.min(100, done / target * 100));
      var c = PALETTE[(i + 2) % PALETTE.length];
      return '<div class="prog-row">' +
        '<div class="prog-top" style="font-size:' + labelFs + 'px">' +
          '<span>' + esc(r[0]) + '</span>' +
          '<b>' + (pct >= 99.95 ? '100' : pct.toFixed(1)) + '%</b>' +
        '</div>' +
        '<div class="prog-track" style="height:' + trackH + 'px">' +
          '<div class="prog-fill" data-w="' + pct + '" style="--c:' + c + ';--c-rgb:' + rgbTriple(c) + '"></div>' +
        '</div>' +
      '</div>';
    }).join('');

    body.appendChild(wrap);
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(wrap.querySelectorAll('.prog-fill'), function (el, i) {
        setTimeout(function () { el.style.width = el.dataset.w + '%'; }, 120 + i * 110);
      });
    });
  }

  /* ---------------- ECharts 通用 ---------------- */
  function dpr() {
    return Math.min(3, (window.devicePixelRatio || 1) * Math.max(1, curScale));
  }

  function track(ch, el) {
    charts.push({ ch: ch, el: el });
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        if (el.clientWidth < 10 || el.clientHeight < 10) return;
        ch.resize();
      });
      ro.observe(el);
    }
  }

  function splitDS(ds) {
    var cols = ds.columns || [];
    var rows = ds.rows || [];
    return {
      names: rows.map(function (r) { return String(r[0]); }),
      series: cols.slice(1).map(function (c, i) {
        return { name: String(c), data: rows.map(function (r) { return num(r[i + 1]); }) };
      })
    };
  }

  function axisCommon() {
    return {
      axisLine: { lineStyle: { color: 'rgba(80,140,200,.25)' } },
      axisTick: { show: false },
      axisLabel: { color: '#7f9bbd', fontSize: 9, margin: 6, hideOverlap: true },
      splitLine: { show: false }
    };
  }

  function renderEChart(body, card, ds, kind) {
    var holder = document.createElement('div');
    holder.className = 'chart';
    body.appendChild(holder);
    if (holder.clientWidth < 10) return;

    var acc = card.__group.accent || '#38bdf8';
    var ch = echarts.init(holder, null, { renderer: 'canvas', devicePixelRatio: dpr() });
    var d = splitDS(ds);
    var opt;

    var tip = {
      trigger: 'axis',
      confine: true,
      backgroundColor: 'rgba(8,24,42,.94)',
      borderColor: 'rgba(78,170,255,.42)',
      borderWidth: 1,
      padding: [6, 9],
      textStyle: { color: '#d8ecff', fontSize: 11 },
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(56,189,248,.1)' } }
    };

    if (kind === 'pie') {
      var w = holder.clientWidth, h = holder.clientHeight;
      /* 三种排布：
         wide   —— 宽卡：右侧竖排图例，饼靠左
         其他   —— 底部横排图例，行数按实际名称宽度算，饼用像素半径铺满剩余空间 */
      var wide = w >= 230 && h >= 110;
      var cramped = h < 96;
      var legendFs = cramped ? 8 : 8.4;

      var cnt = d.names.length;
      var nameMax = Math.max.apply(null, d.names.map(function (n) { return String(n).length; }));
      /* 单条图例估算宽：图标 6 + 间距 5 + 文字（中文按 1em 计） */
      var perItem = nameMax * legendFs + 13;
      var perRow = Math.max(1, Math.floor((w - 4) / perItem));
      var lrows = Math.ceil(cnt / perRow);
      /* 图例真实行高约 11.5px；图例块上下各留 2px */
      var legendH = lrows * Math.max(11.5, legendFs + 2.6) + 2;
      /* 名称不超过 9 字时直接显示全称 */
      var keepFull = nameMax <= 9;

      /* 竖排图例占用的宽度 */
      var legW = wide ? Math.min(w * 0.42, nameMax * 9.6 + 20) : 0;
      var boxW = wide ? (w - legW) : w;
      var boxH = wide ? h : Math.max(20, h - legendH);
      /* 直径取可用宽高的 99%，环形铺满视觉区域 */
      var outer = Math.max(12, Math.min(boxW * 0.49, boxH * 0.49));
      var cx = wide ? (boxW / 2) : (w / 2);
      var cy = wide ? (h / 2) : (boxH / 2);

      var total = d.series[0].data.reduce(function (a, b) { return a + b; }, 0);
      opt = {
        animationDuration: 900,
        color: PALETTE,
        tooltip: {
          trigger: 'item', confine: true,
          backgroundColor: 'rgba(8,24,42,.94)',
          borderColor: 'rgba(78,170,255,.42)', borderWidth: 1, padding: [6, 9],
          textStyle: { color: '#d8ecff', fontSize: 11 },
          formatter: function (p) { return p.name + '<br/>' + fmt(p.value) + (ds.unit ? ' ' + ds.unit : '') + ' · ' + p.percent + '%'; }
        },
        legend: wide ? {
          orient: 'vertical', right: 0, top: 'middle', itemWidth: 7, itemHeight: 7,
          itemGap: 6, icon: 'roundRect',
          textStyle: { color: '#93b1d0', fontSize: 9.5 },
          formatter: function (n) { return n.length > 7 ? n.slice(0, 7) + '…' : n; }
        } : {
          show: true, orient: 'horizontal', left: 'center', bottom: 0,
          itemWidth: 6, itemHeight: 6, itemGap: cramped ? 5 : 7, icon: 'roundRect',
          textStyle: { color: '#93b1d0', fontSize: legendFs },
          formatter: function (n) {
            if (keepFull) return n;
            var lim = perRow >= 2 ? 6 : 4;
            return n.length > lim ? n.slice(0, lim) + '…' : n;
          }
        },
        series: [{
          type: 'pie',
          radius: [Math.round(outer * 0.62), Math.round(outer)],
          center: [Math.round(cx), Math.round(cy)],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: 'rgba(6,16,30,.9)', borderWidth: 1.5 },
          label: { show: false },
          labelLine: { show: false },
          emphasis: { scale: true, scaleSize: 4, label: { show: true, position: 'center', formatter: '{d}%', color: '#fff', fontSize: 12, fontWeight: 600 } },
          data: d.names.map(function (n, i) { return { name: n, value: d.series[0].data[i] }; })
        }]
      };
      ch.setOption(opt);
      track(ch, holder);
      return;
    }

    if (kind === 'barH') {
      opt = {
        animationDuration: 900,
        grid: { left: 2, right: 30, top: 4, bottom: 2, containLabel: true },
        tooltip: tip,
        xAxis: Object.assign({ type: 'value' }, axisCommon(), { axisLabel: { show: false }, splitLine: { show: false } }),
        yAxis: Object.assign({
          type: 'category',
          data: d.names.slice().reverse(),
          axisLabel: { color: '#9fbcd8', fontSize: 10, margin: 8 }
        }, { axisLine: { show: false }, axisTick: { show: false } }),
        series: [{
          type: 'bar',
          data: d.series[0].data.slice().reverse(),
          barWidth: '54%',
          itemStyle: {
            borderRadius: [0, 3, 3, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: hexA(acc, .32) },
              { offset: 1, color: acc }
            ])
          },
          label: {
            show: true, position: 'right', color: '#a8d8f5', fontSize: 9.5,
            fontFamily: 'Consolas, monospace', formatter: function (p) { return p.value; }
          }
        }]
      };
      ch.setOption(opt);
      track(ch, holder);
      return;
    }

    var multi = d.series.length > 1;
    /* 量级差异 >8 倍时启用双 Y 轴，避免小量级序列被压平（折线同样适用） */
    var dual = false;
    if (multi) {
      var mx = d.series.map(function (s) { return Math.max.apply(null, s.data.concat([0])); });
      var mn = d.series.map(function (s) { return Math.max.apply(null, s.data.concat([0])); });
      if (Math.min.apply(null, mn) > 0 && Math.max.apply(null, mx) / Math.min.apply(null, mn) > 4) dual = true;
    }
    /* 双序列同轴时，柱宽随卡片宽度和序列数收缩，避免柱子糊成一片 */
    var barW = dual ? 11 : (multi ? 9 : 14);
    /* X 轴标签：类目少但名称长时自动折两行，并通过旋转/字号确保全部可见 */
    var xNames = d.names.map(function (n) { return String(n); });
    var xMaxLen = xNames.reduce(function (a, n) { return Math.max(a, n.length); }, 0);
    var xN = xNames.length;
    /* 每个类目可用宽度（柱图 boundaryGap 时约等于 width/n） */
    var perSlot = (holder.clientWidth - (dual ? 42 : 14)) / Math.max(1, xN);
    var xFs = 9;
    /* 估算单字宽：中文≈1em，字母数字≈0.6em */
    function estW(s, fs) {
      var wpx = 0;
      for (var k = 0; k < s.length; k++) {
        wpx += /[\u4e00-\u9fa5]/.test(s.charAt(k)) ? fs : fs * 0.6;
      }
      return wpx;
    }
    var xLabelCfg;
    if (xN <= 8 && xMaxLen >= 3 && estW(xNames[0], xFs) > perSlot - 4) {
      /* 名称放不下 → 折成最多两行，字宽取折后较长的一行 */
      var chunk = Math.ceil(xMaxLen / 2);
      var longest = 0;
      xNames.forEach(function (n) { longest = Math.max(longest, estW(n.slice(0, chunk), xFs)); });
      xFs = Math.max(7.5, Math.min(9.5, (perSlot - 5) / Math.max(1, longest) * xFs));
      xLabelCfg = {
        color: '#7f9bbd', fontSize: xFs, interval: 0, hideOverlap: false, margin: 4,
        lineHeight: xFs * 1.18,
        formatter: function (v) {
          if (v.length <= chunk) return v;
          return v.slice(0, chunk) + '\n' + v.slice(chunk);
        }
      };
    } else {
      xLabelCfg = {
        color: '#7f9bbd', fontSize: 9, interval: 'auto', hideOverlap: true, margin: 5
      };
    }

    opt = {
      animationDuration: 900,
      grid: { left: 2, right: dual ? 2 : 8, top: multi ? 20 : 8, bottom: 2, containLabel: true },
      tooltip: tip,
      legend: multi ? {
        top: 0, right: 0, itemWidth: 7, itemHeight: 4, itemGap: 8, icon: 'roundRect',
        textStyle: { color: '#8fadc9', fontSize: 9 }
      } : { show: false },
      xAxis: Object.assign({
        type: 'category', data: d.names, boundaryGap: kind === 'bar',
        axisLabel: xLabelCfg
      }, { axisLine: { lineStyle: { color: 'rgba(80,140,200,.25)' } }, axisTick: { show: false } }),
      yAxis: (function () {
        /* 刻度统一量纲：同一根轴只用一个单位后缀，避免出现 "2w / 1w / 5000" 混排 */
        function mkFmt(mx) {
          return function (v) {
            if (v === 0) return '0';
            var a = Math.abs(v);
            if (mx >= 10000) {
              var q = v / 10000;
              return (Number.isInteger(q) ? q : q.toFixed(1)) + 'w';
            }
            if (mx >= 1000) return Number(v).toLocaleString('en-US');
            return v;
          };
        }
        /* 左轴量纲只看左轴序列（dual 时第 2 条序列走右轴，不参与） */
        var maxL = Math.max.apply(null, d.series[0].data.concat([0]));

        var base = Object.assign({ type: 'value' }, axisCommon(), {
          axisLine: { show: false },
          splitNumber: holder.clientHeight < 110 ? 2 : (holder.clientHeight < 150 ? 3 : 4),
          axisLabel: {
            color: '#63809f', fontSize: 8.5, margin: 4,
            formatter: mkFmt(maxL)
          },
          splitLine: { show: true, lineStyle: { color: 'rgba(80,140,200,.09)', type: 'dashed' } }
        });
        if (!dual) return base;
        var maxR = Math.max.apply(null, d.series[1].data.concat([0]));
        return [
          base,
          Object.assign({}, base, {
            position: 'right', splitLine: { show: false },
            axisLine: { show: false },
            axisLabel: { color: '#7a90ab', fontSize: 8.5, margin: 4, formatter: mkFmt(maxR) }
          })
        ];
      })(),
      series: d.series.map(function (s, i) {
        var c = i === 0 ? acc : PALETTE[(i + 2) % PALETTE.length];
        if (kind === 'line') {
          return {
            name: s.name, type: 'line', data: s.data, smooth: true, symbol: 'circle', symbolSize: 3.5,
            yAxisIndex: dual && i > 0 ? 1 : 0,
            showSymbol: d.names.length <= 8,
            lineStyle: { width: 2, color: c, shadowBlur: 10, shadowColor: hexA(c, .55) },
            itemStyle: { color: c, borderColor: '#07131f', borderWidth: 1 },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: hexA(c, .34) }, { offset: 1, color: hexA(c, 0) }
              ])
            }
          };
        }
        return {
          name: s.name, type: 'bar',
          yAxisIndex: dual && i > 0 ? 1 : 0,
          data: s.data,
          barMaxWidth: barW,
          barGap: '16%',
          itemStyle: {
            borderRadius: [2, 2, 0, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: c }, { offset: 1, color: hexA(c, .2) }
            ])
          }
        };
      })
    };
    ch.setOption(opt);
    track(ch, holder);
  }

  /* ==========================================================
     右侧抽屉
     ========================================================== */
  function buildDrill(card) {
    var ds = card.__ds || {};
    var rows = ds.rows || [];
    var cols = ds.columns || ['项目', '数值'];
    var drill = card.drill || {};

    var title = drill.title || (card.title + ' · 明细');
    var summary = drill.summary;

    if (!summary || !summary.length) {
      summary = [];
      var s0 = rows.reduce(function (a, r) { return a + num(r[1]); }, 0);
      summary.push({ label: '合计', value: fmt(s0), unit: ds.unit || '' });
      summary.push({ label: '均值', value: fmt(rows.length ? s0 / rows.length : 0), unit: ds.unit || '' });
      var mx = rows.slice().sort(function (a, b) { return num(b[1]) - num(a[1]); })[0];
      if (mx) summary.push({ label: '最高 · ' + mx[0], value: fmt(mx[1]), unit: ds.unit || '' });
      summary.push({ label: '记录数', value: rows.length, unit: '条' });
    }

    var useCols = drill.columns || cols;
    var useRows = drill.rows || rows;

    return { title: title, summary: summary, columns: useCols, rows: useRows };
  }

  function openDrawer(card) {
    currentCard = card;
    var d = buildDrill(card);
    var g = card.__group || {};

    $('dwKicker').textContent = 'DETAIL · ' + (g.code || '') + ' ' + (g.en || 'DETAIL');
    $('dwTitle').textContent = d.title;
    $('dwMeta').textContent = (g.name ? g.name + ' / ' : '') + (card.title || '') +
      '　·　数据集 ' + (card.datasetId || '-') + '　·　' + (card.__ds && card.__ds.unit ? '单位 ' + card.__ds.unit : '无单位');

    $('dwSummary').innerHTML = d.summary.map(function (s) {
      return '<div class="sum-chip"><em>' + esc(s.label) + '</em><b>' + esc(s.value) +
        (s.unit ? '<i>' + esc(s.unit) + '</i>' : '') + '</b></div>';
    }).join('');

    var numeric = {};
    d.columns.forEach(function (c, i) {
      var allNum = d.rows.length > 0 && d.rows.every(function (r) {
        return typeof r[i] === 'number' || (typeof r[i] === 'string' && /^-?\d+(\.\d+)?%?$/.test(r[i]));
      });
      numeric[i] = allNum && i > 0;
    });

    $('dwThead').innerHTML = '<tr>' + d.columns.map(function (c) {
      return '<th>' + esc(c) + '</th>';
    }).join('') + '</tr>';

    $('dwTbody').innerHTML = d.rows.map(function (r) {
      return '<tr>' + d.columns.map(function (_, i) {
        var v = r[i];
        if (typeof v === 'string' && /^(达成|未达成|通过|是|否)$/.test(v)) {
          return '<td><span class="tag">' + esc(v) + '</span></td>';
        }
        return '<td class="' + (numeric[i] ? 'num' : '') + '">' +
          esc(typeof v === 'number' ? v.toLocaleString('en-US') : v) + '</td>';
      }).join('') + '</tr>';
    }).join('');

    /* 明细较少时拉伸行高填满可视区，避免抽屉下半部大片空白 */
    requestAnimationFrame(fitDrawerRows);

    $('dwFootL').textContent = '共 ' + d.rows.length + ' 条明细 · ' + d.columns.length + ' 个字段';
    $('dwFootR').textContent = '数据集 ' + (card.datasetId || '-') + ' · 点击放大可全览';

    renderDrawerChart(card, d);

    $('drawer').classList.add('on');
    $('drawer').setAttribute('aria-hidden', 'false');
    $('mask').classList.add('on');
    $('btnZoom').querySelector('span').textContent = '放大';
    $('drawer').classList.remove('zoom');
  }

  /* 明细行数少时按可用高度均分行高，填满抽屉下半区 */
  function fitDrawerRows() {
    var tbody = $('dwTbody');
    var bodyEl = $('dwBody');
    if (!tbody || !bodyEl) return;
    tbody.style.height = '';
    Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (tr) { tr.style.height = ''; });
    var n = tbody.querySelectorAll('tr').length;
    if (!n) return;
    var avail = bodyEl.clientHeight - $('dwThead').offsetHeight - 4;
    if (avail <= 0) return;
    if (tbody.scrollHeight < avail * 0.74) {
      var trs = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
      var rowH = Math.max(30, Math.floor(avail / n));
      trs.forEach(function (tr) { tr.style.height = rowH + 'px'; });
      /* 二次校正：若仍溢出，按超出量回收行高，保证不出现滚动条 */
      var over = bodyEl.scrollHeight - bodyEl.clientHeight;
      if (over > 0) {
        rowH = Math.max(30, rowH - Math.ceil(over / n) - 1);
        trs.forEach(function (tr) { tr.style.height = rowH + 'px'; });
      }
    }
  }

  function renderDrawerChart(card, d) {
    var host = $('dwChart');
    if (dwChart) { dwChart.dispose(); dwChart = null; }
    host.innerHTML = '';
    if (typeof echarts === 'undefined' || !d.rows.length) return;

    dwChart = echarts.init(host, null, { renderer: 'canvas', devicePixelRatio: dpr() });
    var acc = (card.__group && card.__group.accent) || '#38bdf8';
    var numericIdx = [];
    d.columns.forEach(function (c, i) {
      if (i === 0) return;
      var allNum = d.rows.every(function (r) {
        return typeof r[i] === 'number' || (typeof r[i] === 'string' && /^-?\d+(\.\d+)?%?$/.test(r[i]));
      });
      if (allNum) numericIdx.push(i);
    });
    if (!numericIdx.length) return;

    var names = d.rows.map(function (r) { return String(r[0]); });
    var longName = names.some(function (n) { return n.length > 8; });
    /* 柱宽按容器宽度与类目数自适应 */
    var hostW = host.clientWidth || 520;
    var barW = Math.max(10, Math.min(54, (hostW / Math.max(1, names.length)) * 0.42 / Math.max(1, numericIdx.length)));
    var series = numericIdx.map(function (ci, k) {
      return {
        name: d.columns[ci],
        type: 'bar',
        data: d.rows.map(function (r) { return num(r[ci]); }),
        barMaxWidth: barW,
        itemStyle: {
          borderRadius: [3, 3, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: k === 0 ? acc : PALETTE[(k + 2) % PALETTE.length] },
            { offset: 1, color: hexA(k === 0 ? acc : PALETTE[(k + 2) % PALETTE.length], .18) }
          ])
        }
      };
    });

    dwChart.setOption({
      animationDuration: 700,
      grid: { left: 6, right: 14, top: series.length > 1 ? 30 : 14, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis', confine: true,
        backgroundColor: 'rgba(8,24,42,.95)',
        borderColor: 'rgba(78,170,255,.42)', borderWidth: 1,
        textStyle: { color: '#d8ecff', fontSize: 11 },
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(56,189,248,.1)' } }
      },
      legend: series.length > 1 ? {
        top: 0, right: 0, itemWidth: 8, itemHeight: 5, itemGap: 12, icon: 'roundRect',
        textStyle: { color: '#8fadc9', fontSize: 10 }
      } : { show: false },
      xAxis: {
        type: 'category', data: names, boundaryGap: true,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: 'rgba(80,140,200,.25)' } },
        axisLabel: {
          color: '#7f9bbd', fontSize: 9.5, margin: 6, hideOverlap: true,
          interval: 0,
          rotate: longName ? 0 : 0,
          formatter: function (v) { return v.length > 7 ? v.slice(0, 7) + '…' : v; }
        }
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#63809f', fontSize: 9, margin: 4 },
        splitLine: { show: true, lineStyle: { color: 'rgba(80,140,200,.09)', type: 'dashed' } }
      },
      series: series
    });
  }

  function closeDrawer() {
    if (dwChart) { dwChart.dispose(); dwChart = null; }
    $('drawer').classList.remove('on', 'zoom');
    $('drawer').setAttribute('aria-hidden', 'true');
    $('mask').classList.remove('on');
    $('btnZoom').querySelector('span').textContent = '放大';
    currentCard = null;
  }

  function toggleZoom() {
    var dz = $('drawer');
    var on = dz.classList.toggle('zoom');
    $('btnZoom').querySelector('span').textContent = on ? '还原' : '放大';
    setTimeout(function () {
      if (dwChart) dwChart.resize();
      fitDrawerRows();
    }, 360);
  }

  /* ---------------- 启动 ---------------- */
  function boot(cfg) {
    CFG = cfg || window.FALLBACK_CONFIG;
    if (!CFG) {
      document.body.innerHTML = '<div style="color:#fff;padding:40px;font-size:16px">数据配置缺失</div>';
      return;
    }
    stage = $('stage');
    layer = $('layer');

    fitStage();
    window.addEventListener('resize', function () {
      fitStage();
      charts.forEach(function (c) { c.ch.resize(); });
      if (dwChart) dwChart.resize();
    });

    paintHeader();
    render();

    $('btnClose').addEventListener('click', closeDrawer);
    $('mask').addEventListener('click', closeDrawer);
    $('btnZoom').addEventListener('click', function (e) { e.stopPropagation(); toggleZoom(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
    });
    $('drawer').addEventListener('click', function (e) { e.stopPropagation(); });
  }

  function start() {
    loadConfig().then(function (cfg) {
      boot(cfg);
      window.__COCKPIT_READY__ = true;
    }).catch(function (err) {
      console.error('[cockpit] 初始化失败', err);
      boot(window.FALLBACK_CONFIG);
      window.__COCKPIT_READY__ = true;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* 调试接口 */
  window.__COCKPIT__ = {
    get config() { return CFG; },
    get charts() { return charts; },
    openDrawer: function (id) {
      var found = null;
      CFG.groups.forEach(function (g) {
        g.cards.forEach(function (c) { if (c.id === id) found = c; });
      });
      if (found) openDrawer(found);
      return !!found;
    },
    closeDrawer: closeDrawer
  };
})();