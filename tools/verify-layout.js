/**
 * 数据舱自检脚本（可选工具，不影响页面运行）
 *
 * 用途：验证「流式铺满 / 无重叠 / 无内容溢出 / 图表尺寸自适应 / 无 JS 报错 / 分组无缝铺满」
 *
 * 前置：npm i -D playwright-core ，并把下面 EXE 指向本机 Chrome/Chromium
 * 运行：node tools/verify-layout.js
 */
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = process.env.CHROME_PATH ||
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const PAGE = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });

  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(2800);

  /* 入场动画用 translateY(10px) 起手，若在动画期间量测，会把"动画位移"误判成卡片越界。
     这里先强制补上 .in 并关掉过渡，等一帧让布局稳定，再开始测量。 */
  await page.evaluate(() => {
    document.querySelectorAll('.card,.group').forEach(el => {
      el.classList.add('in');
      el.style.transition = 'none';
      el.style.transform = 'none';
      el.style.opacity = '1';
    });
  });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(120);

  const report = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.card')];
    const groups = [...document.querySelectorAll('.group')];
    const cols = [...document.querySelectorAll('.col')];
    const layer = document.getElementById('layer');
    const lr = layer.getBoundingClientRect();

    /* 1. 卡片是否落在所属分组内容区内 */
    const outside = [];
    cards.forEach(c => {
      const gb = c.closest('.g-body').getBoundingClientRect();
      const r = c.getBoundingClientRect();
      if (r.left < gb.left - 1.5 || r.right > gb.right + 1.5 || r.top < gb.top - 1.5 || r.bottom > gb.bottom + 1.5) {
        outside.push(c.dataset.id);
      }
    });

    /* 2. 同组卡片是否重叠 */
    const overlaps = [];
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i].getBoundingClientRect(), b = cards[j].getBoundingClientRect();
        if (a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5) {
          overlaps.push([cards[i].dataset.id, cards[j].dataset.id]);
        }
      }
    }

    /* 3. 分组是否铺满整列（纵向无缝、填满画布高度） */
    const colGaps = [];
    cols.forEach((col, ci) => {
      const gs = [...col.querySelectorAll('.group')];
      let prevBottom = null;
      gs.forEach(g => {
        const r = g.getBoundingClientRect();
        if (prevBottom !== null) {
          const d = r.top - prevBottom;
          if (Math.abs(d - 10) > 1.5) colGaps.push({ col: ci + 1, gap: +d.toFixed(1) });
        }
        prevBottom = r.bottom;
      });
      const lastR = gs[gs.length - 1].getBoundingClientRect();
      if (lr.bottom - lastR.bottom > 1.5) colGaps.push({ col: ci + 1, tailGap: +(lr.bottom - lastR.bottom).toFixed(1) });
    });

    /* 4. 卡片内容是否溢出 */
    const contentOverflow = cards
      .filter(c => c.scrollHeight > c.clientHeight + 2)
      .map(c => ({ id: c.dataset.id, scrollH: c.scrollHeight, clientH: c.clientHeight }));

    /* 5. 图表容器与 canvas 尺寸是否一致 */
    const chartMismatch = [];
    document.querySelectorAll('.chart').forEach(el => {
      const cv = el.querySelector('canvas');
      if (!cv) { chartMismatch.push({ id: el.closest('.card').dataset.id, reason: 'canvas 缺失' }); return; }
      const r = el.getBoundingClientRect(), cr = cv.getBoundingClientRect();
      if (Math.abs(r.width - cr.width) > 2 || Math.abs(r.height - cr.height) > 2) {
        chartMismatch.push({ id: el.closest('.card').dataset.id, wrap: [Math.round(r.width), Math.round(r.height)], canvas: [Math.round(cr.width), Math.round(cr.height)] });
      }
    });

    /* 6. 环形图中心文字是否溢出内圆（仅叠心模式；侧排模式文字在环右侧，不适用） */
    const ringOverflow = [];
    document.querySelectorAll('.ring-wrap').forEach(w => {
      const center = w.querySelector('.ring-center');
      const c = w.querySelector('.ring-center b');
      if (!c || !center || center.classList.contains('side')) return;
      const holder = w.querySelector('.chart');
      const hr = holder.getBoundingClientRect();
      const s = Math.min(hr.width, hr.height);
      const innerD = s * 0.62;
      if (c.scrollWidth > innerD + 1) {
        ringOverflow.push({ id: w.closest('.card').dataset.id, txtW: c.scrollWidth, innerD: Math.round(innerD) });
      }
    });

    /* 6b. 侧排环形：文字块不得超出卡片右边界 */
    document.querySelectorAll('.ring-center.side').forEach(center => {
      const card = center.closest('.card');
      const body = card.querySelector('.c-body');
      const cr = body.getBoundingClientRect();
      const r = center.getBoundingClientRect();
      if (r.right > cr.right + 1.5) {
        ringOverflow.push({ id: card.dataset.id, side: true, overflowRight: +(r.right - cr.right).toFixed(1) });
      }
    });

    return {
      数据源: window.__COCKPIT__.config.__source,
      卡片数: cards.length,
      分组数: groups.length,
      列数: cols.length,
      图表实例: window.__COCKPIT__.charts.length,
      卡片越界: outside,
      卡片重叠: overlaps,
      列内空隙异常: colGaps,
      内容溢出: contentOverflow,
      图表尺寸不匹配: chartMismatch,
      环形文字溢出: ringOverflow
    };
  });

  console.log(JSON.stringify(report, null, 2));
  console.log('JS 错误：' + (errors.length ? '\n' + errors.join('\n') : '无'));

  const ok = !report.卡片越界.length && !report.卡片重叠.length && !report.列内空隙异常.length &&
    !report.内容溢出.length && !report.图表尺寸不匹配.length && !report.环形文字溢出.length && !errors.length;
  console.log(ok ? '\n✅ 全部检查通过' : '\n❌ 存在待修问题');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
