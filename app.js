/* v0.4.2: Sharper weather Gaussian, stronger twilight peak, lighter moon; astronomy fallback */
const KONUM_INPUT = document.getElementById('konum');
const GUN_SELECT  = document.getElementById('gunSayisi');
const SONUCLAR    = document.getElementById('sonuclar');
const AUTO_SWITCH = document.getElementById('autoUpdate');

// Modal
const MODAL_BACKDROP = document.getElementById('modalBackdrop');
const MODAL_CLOSE    = document.getElementById('modalClose');
const MODAL_TITLE    = document.getElementById('modalTitle');
const CANVAS         = document.getElementById('detailCanvas');
const RANGES_TEXT    = document.getElementById('rangesText');

let lastQuery = { q:'', days:null, lat:null, lon:null };
let perDayHourly = {};        // date -> [{hour, score}]
let perDayMarkers = {};       // date -> {sunrise, sunset, moonrise, moonset}

function debounce(fn, wait=700){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }

// ---------- GEO ----------
async function geocodePlace(place){
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(place)}&limit=1`;
  const res = await fetch(url,{headers:{'Accept':'application/json'}});
  if(!res.ok) throw new Error('Konum servisine ulaşılamadı');
  const arr = await res.json();
  if(!arr || !arr.length) throw new Error('Konum bulunamadı');
  return { lat:+arr[0].lat, lon:+arr[0].lon, display_name:arr[0].display_name };
}

// ---------- FORECAST (includes sunrise/sunset in daily) ----------
async function fetchForecast(lat, lon, days){
  const dailyVars  = 'temperature_2m_max,temperature_2m_min,sunrise,sunset';
  const hourlyVars = 'windspeed_10m,pressure_msl,temperature_2m';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
            + `&timezone=auto&forecast_days=${Math.max(1,Math.min(7,Number(days)||5))}`
            + `&daily=${dailyVars}&hourly=${hourlyVars}`;
  const r = await fetch(url,{mode:'cors'});
  if(!r.ok){ const t = await r.text().catch(()=> ''); throw new Error('Hava verisi alınamadı'+(t?` (${t.slice(0,120)}...)`:'')); }
  return r.json();
}

// ---------- OPTIONAL ASTRONOMY (moonrise/moonset + moon_phase) ----------
function fmtYMD(d){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
async function fetchAstronomy(lat, lon, days){
  try{
    const d = Math.max(1, Math.min(7, Number(days) || 5));
    const start = new Date();
    const end = new Date(); end.setDate(start.getDate() + d - 1);
    const daily = 'moon_phase,moonrise,moonset';
    const url = `https://api.open-meteo.com/v1/astronomy?latitude=${lat}&longitude=${lon}`
              + `&timezone=auto&start_date=${fmtYMD(start)}&end_date=${fmtYMD(end)}`
              + `&daily=${daily}`;
    const r = await fetch(url, { mode:'cors' });
    if(!r.ok) return null; // graceful fallback
    return await r.json();
  }catch(e){ console.warn('Astronomy fallback:', e); return null; }
}

// ---------- WEATHER SCORE (Sharper Gaussian) ----------
function weatherScore(wind, pressure, temp){
  const gauss = (x, mu, sigma) => Math.exp(-((x-mu)*(x-mu))/(2*sigma*sigma))*100;
  const w = gauss(wind, 8, 4.5);     // rüzgar
  const p = gauss(pressure, 1015, 5.5); // basınç
  const T = gauss(temp, 18, 4.0);    // sıcaklık
  return Math.max(0, Math.min(100, Math.round(w*0.5 + p*0.3 + T*0.2)));
}

// ---------- TIME HELPERS ----------
const toHour = s => { const d = new Date(s); return d.getHours() + d.getMinutes()/60; };
const hGauss = (h, center, sigmaH) => Math.exp(-((h-center)*(h-center))/(2*sigmaH*sigmaH))*100;

// Boost weights
const TWILIGHT_BOOST_MAX = 28;  // ↑
const TWILIGHT_SIGMA_H   = 1.2; // ↑
const MOON_BOOST_MAX     = 6;   // ↓
const MOON_SIGMA_H       = 1.0;

// ---------- COMPUTE ----------
function computeDaily(forecast, astro){
  const out = [];
  perDayHourly = {};
  perDayMarkers = {};

  const dates   = forecast.daily?.time || [];
  const hrTimes = forecast.hourly?.time || [];
  const hrWind  = forecast.hourly?.windspeed_10m || [];
  const hrPres  = forecast.hourly?.pressure_msl || [];
  const hrTemp  = forecast.hourly?.temperature_2m || [];

  const A = astro?.daily || {};
  const idxOf = (arr, d) => (arr||[]).findIndex(x => x === d);

  for(let i=0;i<dates.length;i++){
    const date    = dates[i];
    const sunrise = forecast.daily?.sunrise?.[i] ? toHour(forecast.daily.sunrise[i]) : null;
    const sunset  = forecast.daily?.sunset?.[i]  ? toHour(forecast.daily.sunset[i])  : null;

    // optional moon markers
    const ai = idxOf(A.time, date);
    const moonrise = (A.moonrise && A.moonrise[ai]) ? toHour(A.moonrise[ai]) : null;
    const moonset  = (A.moonset && A.moonset[ai])   ? toHour(A.moonset[ai])  : null;

    perDayMarkers[date] = { sunrise, sunset, moonrise, moonset };

    // Saatlik skorlar (0–23)
    const hours = [];
    for(let j=0;j<hrTimes.length;j++){
      const t = hrTimes[j];
      if(!t.startsWith(date)) continue;
      const h = parseInt(t.slice(11,13));
      if(h<0 || h>23) continue;

      const w = hrWind?.[j]; const p = hrPres?.[j]; const T = hrTemp?.[j];
      if(w==null || p==null || T==null) continue;

      // 1) Hava skoru
      let s = weatherScore(w,p,T);

      // 2) Twilight boost
      if(sunrise!=null) s = Math.min(100, s + hGauss(h, sunrise, TWILIGHT_SIGMA_H)* (TWILIGHT_BOOST_MAX/100));
      if(sunset !=null) s = Math.min(100, s + hGauss(h, sunset,  TWILIGHT_SIGMA_H)* (TWILIGHT_BOOST_MAX/100));

      // 3) Moon boost (optional)
      if(moonrise!=null) s = Math.min(100, s + hGauss(h, moonrise, MOON_SIGMA_H)* (MOON_BOOST_MAX/100));
      if(moonset!=null) s = Math.min(100, s + hGauss(h, moonset,  MOON_SIGMA_H)* (MOON_BOOST_MAX/100));

      hours.push({ hour:h, score: Math.round(s) });
    }
    perDayHourly[date] = hours;

    // Dinamik eşik: p70 (55..85)
    const sorted = [...hours].map(x=>x.score).sort((a,b)=>a-b);
    const p70 = sorted.length ? sorted[Math.floor(sorted.length*0.70)] : 70;
    const CUTOFF = Math.max(55, Math.min(85, p70));

    // Eşik üstü bloklar
    const blocks=[]; let cur=[];
    for(const h of hours){
      if(h.score>=CUTOFF){
        if(cur.length===0 || h.hour===cur[cur.length-1].hour+1) cur.push(h);
        else { if(cur.length>=2) blocks.push(cur); cur=[h]; }
      } else { if(cur.length>=2) blocks.push(cur); cur=[]; }
    }
    if(cur.length>=2) blocks.push(cur);

    const ranked = blocks.map(b=>{
      const avg = Math.round(b.reduce((s,v)=>s+v.score,0)/b.length);
      return { start:b[0].hour, end:b[b.length-1].hour+1, avgScore:avg, len:b.length };
    }).sort((a,b)=> b.avgScore - a.avgScore || b.len - a.len);

    const bestRanges = ranked.slice(0,3).map(r => `${String(r.start).padStart(2,'0')}:00–${String(r.end).padStart(2,'0')}:00`);

    const dayScore = ranked[0]?.avgScore ?? Math.round(sorted.reduce((s,v)=>s+v,0)/(sorted.length||1));

    let label='Zayıf', color='#ef4444', badge='🔴 Zayıf';
    if(dayScore >= 70){ label='Harika gün'; color='#10b981'; badge='🟢 Harika'; }
    else if(dayScore >= 45){ label='Orta şans'; color='#f59e0b'; badge='🟠 Orta'; }

    out.push({
      date, dayScore, label, color, badge,
      moonPct: (astro?.daily?.moon_phase?.[ai] != null) ? Math.round(astro.daily.moon_phase[ai]*100) : 50,
      bestRanges, cutoff:CUTOFF
    });
  }
  return out;
}

// ---------- RENDER ----------
function render(placeName, arr){
  SONUCLAR.innerHTML='';
  const header=document.createElement('div');
  header.className='card';
  header.innerHTML=`<div><strong class="place">${placeName}</strong> — ${arr.length} gün</div>`;
  SONUCLAR.appendChild(header);

  arr.forEach(r=>{
    const el=document.createElement('div');
    el.className='card';
    el.style.borderColor=r.color;
    el.innerHTML=`
      <div class="row" style="justify-content:space-between">
        <div>
          <div class="muted">${new Date(r.date).toLocaleDateString('tr-TR',{weekday:'short', day:'2-digit', month:'short'})}</div>
          <div class="badge" style="background:${r.color}22;color:${r.color}">${r.badge}</div>
        </div>
        <div style="text-align:right">
          <div class="score" style="color:${r.color}">${r.dayScore}</div>
          <div class="muted">${r.label}</div>
        </div>
      </div>
      <div class="hint">Ay: ${r.moonPct} • Eşik (dinamik): ${r.cutoff}</div>
      <div class="hours"><span class="muted">En iyi saat aralıkları:</span> ${
        r.bestRanges.length ? r.bestRanges.map(rg=>`<span class="chip">${rg}</span>`).join('') : '<span class="chip">—</span>'
      }</div>
      <div style="margin-top:10px;text-align:right">
        <button class="btn detail-btn" data-date="${r.date}">Detay</button>
      </div>`;
    SONUCLAR.appendChild(el);
  });

  document.querySelectorAll('.detail-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const d=btn.getAttribute('data-date');
      openDetailModal(d, placeName);
    });
  });
}

// ---------- MODAL / CHART ----------
function computeRangesForDay(hours, cutoff){
  const MIN_LEN=2; const blocks=[]; let cur=[];
  for(const h of hours){
    if(h.score>=cutoff){
      if(cur.length===0 || h.hour===cur[cur.length-1].hour+1) cur.push(h);
      else { if(cur.length>=MIN_LEN) blocks.push(cur); cur=[h]; }
    }else{ if(cur.length>=MIN_LEN) blocks.push(cur); cur=[]; }
  }
  if(cur.length>=MIN_LEN) blocks.push(cur);
  return blocks.map(b=>`${String(b[0].hour).padStart(2,'0')}:00–${String(b[b.length-1].hour+1).padStart(2,'0')}:00`);
}

function openDetailModal(dateStr, placeName){
  const hours = perDayHourly[dateStr] || [];
  const markers = perDayMarkers[dateStr] || {};
  drawChart(hours, markers);
  const pretty=new Date(dateStr).toLocaleDateString('tr-TR',{weekday:'long',day:'2-digit',month:'long'});
  MODAL_TITLE.textContent=`${placeName} — ${pretty}`;
  const sorted=[...hours].map(x=>x.score).sort((a,b)=>a-b);
  const p70 = sorted.length ? sorted[Math.floor(sorted.length*0.70)] : 70;
  const cutoff=Math.max(55,Math.min(85,p70));
  const labels=computeRangesForDay(hours, cutoff);
  RANGES_TEXT.textContent=labels.length?`En iyi saat aralıkları: ${labels.join(', ')}`:'Eşik üstünde saat aralığı yok';
  MODAL_BACKDROP.style.display='flex';
  MODAL_BACKDROP.setAttribute('aria-hidden','true'); // accessibility off until shown
  MODAL_BACKDROP.style.display='flex';
  MODAL_BACKDROP.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
}

function closeModal(){ MODAL_BACKDROP.style.display='none'; MODAL_BACKDROP.setAttribute('aria-hidden','true'); document.body.style.overflow=''; }
MODAL_CLOSE.addEventListener('click', closeModal);
MODAL_BACKDROP.addEventListener('click', e=>{ if(e.target===MODAL_BACKDROP) closeModal(); });

function drawChart(hours, markers){
  const ctx=CANVAS.getContext('2d');
  ctx.clearRect(0,0,CANVAS.width,CANVAS.height);
  const m={left:50,right:20,top:20,bottom:40};
  const w=CANVAS.width-m.left-m.right, h=CANVAS.height-m.top-m.bottom;
  const xScale=x=>m.left+(x/24)*w, yScale=y=>m.top+(1-y/100)*h;

  // axes
  ctx.lineWidth=1; ctx.strokeStyle='#6b7280';
  ctx.beginPath(); ctx.moveTo(m.left,m.top); ctx.lineTo(m.left,m.top+h); ctx.lineTo(m.left+w,m.top+h); ctx.stroke();

  // grid + labels
  ctx.fillStyle='#cbd5e1'; ctx.textAlign='center'; ctx.textBaseline='top';
  for(let hr=0;hr<=24;hr+=3){ const x=xScale(hr); ctx.fillText(String(hr).padStart(2,'0'), x, m.top+h+6);
    ctx.strokeStyle='#1f2937'; ctx.beginPath(); ctx.moveTo(x,m.top); ctx.lineTo(x,m.top+h); ctx.stroke(); }
  ctx.textAlign='right'; ctx.textBaseline='middle';
  for(let v=0;v<=100;v+=20){ const y=yScale(v); ctx.fillText(String(v), m.left-8, y);
    ctx.strokeStyle='#1f2937'; ctx.beginPath(); ctx.moveTo(m.left,y); ctx.lineTo(m.left+w,y); ctx.stroke(); }

  // markers: sunrise/sunset (solid), moonrise/moonset (dotted)
  const drawV=(hour, style)=>{ if(hour==null) return; ctx.save(); ctx.strokeStyle=style.color; ctx.setLineDash(style.dash||[]); ctx.beginPath(); ctx.moveTo(xScale(hour), m.top); ctx.lineTo(xScale(hour), m.top+h); ctx.stroke(); ctx.restore(); };
  drawV(markers.sunrise,  {color:'#4ade80'});             // green
  drawV(markers.sunset,   {color:'#f87171'});             // red
  drawV(markers.moonrise, {color:'#93c5fd', dash:[4,4]}); // blue dotted
  drawV(markers.moonset,  {color:'#93c5fd', dash:[4,4]});

  // line
  const xs=hours.map(d=>d.hour), ys=hours.map(d=>d.score);
  if(xs.length){
    ctx.strokeStyle='#eab308'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(xScale(xs[0]), yScale(ys[0]));
    for(let i=1;i<xs.length;i++) ctx.lineTo(xScale(xs[i]), yScale(ys[i]));
    ctx.stroke();
    ctx.fillStyle='#eab308';
    for(let i=0;i<xs.length;i++){ const x=xScale(xs[i]), y=yScale(ys[i]); ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill(); }
  }
}

// ---------- QUERY FLOW ----------
async function doQuery(placeStr, days){
  try{
    SONUCLAR.innerHTML='<div class="card">Veriler çekiliyor…</div>';
    let lat,lon,placeName=placeStr;
    const parts=placeStr.split(',').map(s=>s.trim());
    if(parts.length===2 && !isNaN(Number(parts[0]))){ lat=+parts[0]; lon=+parts[1]; placeName=`Koordinat: ${lat.toFixed(4)}, ${lon.toFixed(4)}`; }
    else { const g=await geocodePlace(placeStr); lat=g.lat; lon=g.lon; placeName=g.display_name; }
    const [fc, astro] = await Promise.all([ fetchForecast(lat,lon,days), fetchAstronomy(lat,lon,days) ]);
    const daily = computeDaily(fc, astro);
    render(placeName, daily);
    lastQuery={ q:placeStr, days, lat, lon, updatedAt:new Date().toISOString() };
  }catch(err){ SONUCLAR.innerHTML=`<div class="card">Hata: ${err.message||err}</div>`; console.error(err); }
}

// ---------- AUTORUN ----------
function debounce2(fn, w=700){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), w); }; }
const autoHandler = debounce2(()=>{ if(!AUTO_SWITCH.checked) return;
  const place=(KONUM_INPUT.value||'').trim(); const days=Number(GUN_SELECT.value||3);
  if(!place){ SONUCLAR.innerHTML='<div class="card">Lütfen konum girin.</div>'; return; }
  if(lastQuery.q===place && lastQuery.days===days) return;
  doQuery(place, days);
}, 700);

KONUM_INPUT.addEventListener('input', autoHandler);
GUN_SELECT.addEventListener('change', autoHandler);
AUTO_SWITCH.addEventListener('change', ()=>{ if(AUTO_SWITCH.checked) autoHandler(); });

function tryUseBrowserLocation(){
  if(!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos=>{
    const {latitude:lat, longitude:lon} = pos.coords;
    KONUM_INPUT.value = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    autoHandler();
  }, err=>{ console.log('Konum reddedildi:', err?.message); }, { timeout:5000 });
}

window.addEventListener('DOMContentLoaded', ()=>{
  if(!KONUM_INPUT.value || KONUM_INPUT.value.trim()==='') tryUseBrowserLocation();
  setTimeout(()=>autoHandler(), 300);
});
