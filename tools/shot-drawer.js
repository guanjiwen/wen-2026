const path=require('path');
const {chromium}=require('playwright-core');
const EXE=process.env.CHROME_PATH||'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const PAGE='file:///'+path.resolve(__dirname,'..','index.html').replace(/\\/g,'/');
(async()=>{
  const b=await chromium.launch({executablePath:EXE,args:['--allow-file-access-from-files']});
  const p=await b.newPage({viewport:{width:1920,height:1080}});
  await p.goto(PAGE,{waitUntil:'load'});
  await p.waitForTimeout(1600);
  /* 点开"楼栋保障排行"卡片，展示明细抽屉 */
  const ok = await p.evaluate(()=>{
    const c=[...document.querySelectorAll('.card')].find(c=>{
      const t=c.querySelector('.c-title');return t&&t.textContent.trim()==='楼栋保障排行';});
    if(!c) return false; c.click(); return true;
  });
  console.log('点击卡片:', ok);
  await p.waitForTimeout(1100);
  await p.screenshot({path:path.resolve(__dirname,'..','preview-drawer.png')});
  await b.close();
})();