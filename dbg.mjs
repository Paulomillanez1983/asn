import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 393, height: 851 } });
await p.addInitScript(() => localStorage.setItem('asn.intro','1'));
await p.route('**/*', r => {
  const u = r.request().url();
  if (u.includes('open-meteo.com') || u.includes('api.met.no') || u.includes('nominatim') || u.includes('photon') || /\/api\//.test(new URL(u).pathname)) return r.abort();
  return r.continue();
});
await p.goto('https://asn.asn-clima.workers.dev/');
await p.waitForTimeout(800);
const out = await p.evaluate(() => {
  const times = Array.from({length:12},(_,i)=>`2026-10-19T${String(10+i).padStart(2,'0')}:00`);
  const hours = times.map(()=>({p:0,prob:5,gust:30,cl:40}));
  const models = ['ecmwf_ifs025','gfs_seamless','icon_seamless','gem_seamless'].map(m=>({m,l:0,rain:false,wind:false,hail:false,acc:0,rate:0,hours}));
  S.places=[{id:'t1',label:'Casa',addr:'x',kind:'casa',lat:-31.29,lon:-64.3}];
  S.data={t1:{level:0,votes:{rain:0,wind:0},ens:{n:50,rain15:.5,gust60:.1},models,times,current:{temperature_2m:18,wind_gusts_10m:30,weather_code:1,precipitation:0},snowHours:times.map(()=>0),snow3:0,hailPossible:false,storm:false,rainRate:0,gustMax:30,sunrise:['2026-10-19T06:33'],sunset:['2026-10-19T19:31']}};
  S.busy=false;S.view='home';paint();
  return {
    n: document.querySelectorAll('.tl').length,
    night: document.querySelectorAll('.tl.night').length,
    cls: Array.from(document.querySelectorAll('.tl')).map(e=>e.className),
    isNight: isNightAt(S.data.t1,'2026-10-19T20:00'),
    sun: S.data.t1.sunrise
  };
});
console.log(JSON.stringify(out, null, 2));
await b.close();
