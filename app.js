/* v0.3: Günlük detay grafik (canvas) + Open-Meteo Forecast + Astronomy (moon)
   - Kartlarda 'Detay' butonu -> modal içinde saat vs ihtimal grafiği
   - Eşik üstü saat aralıkları metin olarak da gösterilir
*/
const KONUM_INPUT = document.getElementById('konum');
const GUN_SELECT  = document.getElementById('gunSayisi');
const SONUCLAR    = document.getElementById('sonuclar');
const AUTO_SWITCH = document.getElementById('autoUpdate');

// Modal elemanları
const MODAL_BACKDROP = document.getElementById('modalBackdrop');
const MODAL_CLOSE    = document.getElementById('modalClose');
const MODAL_TITLE    = document.getElementById('modalTitle');
const CANVAS         = document.getElementById('detailCanvas');
const RANGES_TEXT    = document.getElementById('rangesText');

let lastQuery = { q:'', days:null, lat:null, lon:null };
let perDayHourly = {}; // date -> [{hour, score}]

function debounce(fn, wait=700){
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); };
}

// ---- Geocoding ----
async function geocodePlace(place){
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(place)}&limit=1`;
  const res = await fetch(url, { headers: { 'Accept':'application/json' } });
  if(!res.ok) throw new Error('Konum servisine ulaşılamadı');
  const arr = await res.json();
  if(!arr || !arr.length) throw new Error('Konum bulunamadı');
  return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon), display_name: arr[0].display_name };
}

// ---- Forecast (daily+hourly) ----
async function fetchForecast(lat, lon, days){
  const dailyVars  = 'temperature_2m_max,temperature_2m_min';
  const hourlyVars = 'windspeed_10m,pressure_msl,temperature_2m';
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&timezone=auto&forecast_days=${Math.max(1, Math.min(7, Number(days)||5))}` +
    `&daily=${dailyVars}&hourly=${hourlyVars}`;
  const res = await fetch(url, { mode:'cors' });
  if(!res.ok){
    const txt = await res.text().catch(()=> '');
    throw new Error('Hava verisi alınamadı' + (txt ? ` (${txt.slice(0,120)}...)` : ''));
  }
  return await res.json();
}

// ---- Astronomy (moon) ----
async function fetchMoon(lat, lon, days){
  const url =
    `https://api.open-meteo.com/v1/astronomy?latitude=${lat}&longitude=${lon}` +
    `&timezone=auto&forecast_days=${Math.max(1, Math.min(7, Number(days)||5))}` +
    `&daily=moon_phase`;
  const res = await fetch(url, { mode:'cors' });
  if(!res.ok){
    const txt = await res.text().catch(()=> '');
    throw new Error('Ay verisi alınamadı' + (txt ? ` (${txt.slice(0,120)}...)` : ''));
  }
  return await res.json();
}

// ---- Scoring ----
function hourlyScore(wind, pressure, temp){
  const wScore = Math.max(0, 100 - Math.abs(wind - 8)*6);
  const pScore = Math.max(0, 100 - Math.abs(pressure - 1015));
  const tScore = Math.max(0, 100 - Math.abs(temp - 18)*5);
  return Math.round(wScore*0.4 + pScore*0.3 + tScore*0.3);
}

// ---- Compute & store ----
function computeDaily(forecast, moonData){
  const CUTOFF = 70;
  const MIN_BLOCK_LEN = 2;

  const out = [];
  perDayHourly = {}; // reset

  const dates   = forecast.daily?.time || [];
  const hrTimes = forecast.hourly?.time || [];
  const hrWind  = forecast.hourly?.windspeed_10m || [];
  const hrPres  = forecast.hourly?.pressure_msl || [];
  const hrTemp  = forecast.hourly?.temperature_2m || [];

  const moonMap = {};
  if(moonData?.daily?.time && moonData.daily.moon_phase){
    for(let i=0;i<moonData.daily.time.length;i++){
      moonMap[ moonData.daily.time[i] ] = Number(moonData.daily.moon_phase[i] ?? 0.5);
    }
  }

  for(let i=0;i<dates.length;i++){
    const date = dates[i];
    const tmax = forecast.daily?.temperature_2m_max?.[i] ?? null;
    const tmin = forecast.daily?.temperature_2m_min?.[i] ?? null;

    // Saatlik skorlar
    const hours = [];
    for(let j=0;j<hrTimes.length;j++){
      const t = hrTimes[j];
      if(t.startsWith(date)){
        const h = parseInt(t.slice(11,13));
        if(h>=5 && h<=21){
          const w = hrWind?.[j]; const p = hrPres?.[j]; const T = hrTemp?.[j];
          if(w!=null && p!=null && T!=null){
            hours.push({ hour:h, score: hourlyScore(w,p,T) });
          }
        }
      }
    }
    perDayHourly[date] = hours;

    // Eşik üstü ardışık bloklar
    const blocks = [];
    let cur = [];
    for(const h of hours){
      if(h.score >= CUTOFF){
        if(cur.length===0 || h.hour === cur[cur.length-1].hour+1){
          cur.push(h);
        } else {
          if(cur.length >= MIN_BLOCK_LEN) blocks.push(cur);
          cur = [h];
        }
      } else {
        if(cur.length >= MIN_BLOCK_LEN) blocks.push(cur);
        cur = [];
      }
    }
    if(cur.length >= MIN_BLOCK_LEN) blocks.push(cur);

    const ranked = blocks
      .map(b => {
        const avg = Math.round(b.reduce((s,v)=>s+v.score,0)/b.length);
        return { start:b[0].hour, end:b[b.length-1].hour+1, avgScore:avg, len:b.length };
      })
      .sort((a,b)=> b.avgScore - a.avgScore || b.len - a.len);

    const bestRanges = ranked.slice(0,3).map(r =>
      `${String(r.start).padStart(2,'0')}:00–${String(r.end).padStart(2,'0')}:00`
    );

    const findIndex = (H) => hrTimes.findIndex(tt => tt.startsWith(date) && parseInt(tt.slice(11,13))===H);
    const arrPick = (arr, hoursList) => hoursList.map(h => arr[ findIndex(h) ]).filter(v=>v!=null);
    const avg = (arr) => Math.round(arr.reduce((s,v)=>s+v,0)/arr.length);

    const pickHours = ranked[0] ? Array.from({length: ranked[0].len}, (_,k)=> ranked[0].start + k) : [];
    const windAvg = pickHours.length ? avg(arrPick(hrWind, pickHours)) : null;
    const presAvg = pickHours.length ? avg(arrPick(hrPres, pickHours)) : null;
    const tempAvg = pickHours.length ? avg(arrPick(hrTemp, pickHours)) :
                      ((tmax!=null && tmin!=null) ? Math.round((tmax+tmin)/2) : null);

    const moonP   = (moonMap[date] != null) ? moonMap[date] : 0.5;
    const moonPct = Math.round(moonP * 100);

    let topAvg = 50;
    if(ranked[0]) topAvg = ranked[0].avgScore;
    else if(hours.length){
      const top3 = [...hours].sort((a,b)=>b.score-a.score).slice(0,3);
      topAvg = Math.round(top3.reduce((s,v)=>s+v.score,0)/(top3.length||1));
    }
    const dayScore = Math.round(topAvg*0.8 + moonPct*0.2);

    let label='Zayıf', color='#ef4444', badge='🔴 Zayıf';
    if(dayScore >= 70){ label='Harika gün'; color='#10b981'; badge='🟢 Harika'; }
    else if(dayScore >= 45){ label='Orta şans'; color='#f59e0b'; badge='🟠 Orta'; }

    out.push({
      date, dayScore, label, color, badge,
      windAvg: (windAvg ?? '-'),
      presAvg: (presAvg ?? '-'),
      tempAvg: (tempAvg ?? '-'),
      moonPct,
      bestRanges
    });
  }

  return out;
}

// ---- Render ----
function render(placeName, arr){
  SONUCLAR.innerHTML = '';
  const header = document.createElement('div');
  header.className='card';
  header.innerHTML = `<div><strong class="place">${placeName}</strong> — ${arr.length} gün</div>`;
  SONUCLAR.appendChild(header);

  arr.forEach(r=>{
    const el = document.createElement('div');
    el.className = 'card';
    el.style.borderColor = r.color;
    el.innerHTML = `
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
      <div class="hint">Rüzgar avg: ${r.windAvg} km/s • Basınç avg: ${r.presAvg} hPa • Sıcaklık avg: ${r.tempAvg}°C • Ay: ${r.moonPct}</div>
      <div class="hours"><span class="muted">En iyi saat aralıkları:</span> ${
        r.bestRanges.length ? r.bestRanges.map(rg=>`<span class="chip">${rg}</span>`).join('') : '<span class="chip">—</span>'
      }</div>
      <div style="margin-top:10px;text-align:right">
        <button class="btn detail-btn" data-date="${r.date}">Detay</button>
      </div>
    `;
    SONUCLAR.appendChild(el);
  });

  // Detay butonları
  document.querySelectorAll('.detail-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.getAttribute('data-date');
      openDetailModal(d, placeName);
    });
  });
}

// ---- Modal controls ----
function openDetailModal(dateStr, placeName){
  const hours = perDayHourly[dateStr] || [];
  drawChart(hours, dateStr);
  const pretty = new Date(dateStr).toLocaleDateString('tr-TR', { weekday:'long', day:'2-digit', month:'long' });
  MODAL_TITLE.textContent = `${placeName} — ${pretty}`;
  // Compose ranges text from cutoff logic inside drawChart (it returns labels)
  const labels = computeRanges(hours);
  RANGES_TEXT.textContent = labels.length ? `En iyi saat aralıkları: ${labels.join(', ')}` : 'Eşik üstünde saat aralığı yok';
  MODAL_BACKDROP.style.display = 'flex';
  MODAL_BACKDROP.setAttribute('aria-hidden','false');
  document.body.style.overflow = 'hidden';
}

function closeModal(){
  MODAL_BACKDROP.style.display = 'none';
  MODAL_BACKDROP.setAttribute('aria-hidden','true');
  document.body.style.overflow = '';
}

MODAL_CLOSE.addEventListener('click', closeModal);
MODAL_BACKDROP.addEventListener('click', (e)=>{ if(e.target === MODAL_BACKDROP) closeModal(); });

// ---- Chart / ranges ----
function computeRanges(hours){
  const CUTOFF = 70, MIN_BLOCK_LEN = 2;
  const blocks = [];
  let cur = [];
  for(const h of hours){
    if(h.score >= CUTOFF){
      if(cur.length===0 || h.hour === cur[cur.length-1].hour+1){
        cur.push(h);
      } else {
        if(cur.length >= MIN_BLOCK_LEN) blocks.push(cur);
        cur = [h];
      }
    } else {
      if(cur.length >= MIN_BLOCK_LEN) blocks.push(cur);
      cur = [];
    }
  }
  if(cur.length >= MIN_BLOCK_LEN) blocks.push(cur);
  const labels = blocks.map(b => {
    const s = b[0].hour, e = b[b.length-1].hour + 1;
    return `${String(s).padStart(2,'0')}:00–${String(e).padStart(2,'0')}:00`;
  });
  return labels;
}

function drawChart(hours, dateStr){
  const ctx = CANVAS.getContext('2d');
  // Clear
  ctx.clearRect(0,0,CANVAS.width,CANVAS.height);

  // Margins
  const m = {left:50, right:20, top:20, bottom:40};
  const w = CANVAS.width - m.left - m.right;
  const h = CANVAS.height - m.top - m.bottom;

  // Data domain
  const xs = hours.map(d=>d.hour);
  const ys = hours.map(d=>d.score);
  const xMin = 5, xMax = 21;
  const yMin = 0, yMax = 100;

  const xScale = x => m.left + ( (x - xMin) / (xMax - xMin) ) * w;
  const yScale = y => m.top  + (1 - (y - yMin) / (yMax - yMin)) * h;

  // Axes
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#6b7280';
  ctx.beginPath();
  ctx.moveTo(m.left, m.top);
  ctx.lineTo(m.left, m.top+h);
  ctx.lineTo(m.left+w, m.top+h);
  ctx.stroke();

  // Grid + labels
  ctx.fillStyle = '#cbd5e1';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for(let hr=5; hr<=21; hr+=2){
    const x = xScale(hr);
    ctx.fillText(String(hr).padStart(2,'0'), x, m.top+h+6);
    ctx.strokeStyle = '#1f2937';
    ctx.beginPath(); ctx.moveTo(x, m.top); ctx.lineTo(x, m.top+h); ctx.stroke();
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for(let v=0; v<=100; v+=20){
    const y = yScale(v);
    ctx.fillText(String(v), m.left-8, y);
    ctx.strokeStyle = '#1f2937';
    ctx.beginPath(); ctx.moveTo(m.left, y); ctx.lineTo(m.left+w, y); ctx.stroke();
  }

  // Cutoff line
  const CUTOFF = 70;
  ctx.strokeStyle = '#fbbf24';
  ctx.setLineDash([6,4]);
  ctx.beginPath();
  ctx.moveTo(m.left, yScale(CUTOFF));
  ctx.lineTo(m.left+w, yScale(CUTOFF));
  ctx.stroke();
  ctx.setLineDash([]);

  // Ranges shading
  const labels = computeRanges(hours);
  ctx.fillStyle = 'rgba(16,185,129,0.15)'; // soft greenish
  for(const lab of labels){
    const [s,e] = lab.split('–').map(t => parseInt(t.slice(0,2),10));
    const x1 = xScale(s);
    const x2 = xScale(e);
    ctx.fillRect(x1, m.top, x2-x1, h);
  }

  // Line path
  if(xs.length){
    ctx.strokeStyle = '#eab308'; // amber-ish
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xScale(xs[0]), yScale(ys[0]));
    for(let i=1;i<xs.length;i++){
      ctx.lineTo(xScale(xs[i]), yScale(ys[i]));
    }
    ctx.stroke();

    // Markers
    ctx.fillStyle = '#eab308';
    for(let i=0;i<xs.length;i++){
      const x = xScale(xs[i]), y = yScale(ys[i]);
      ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
    }
  }
}

// ---- Query flow ----
async function doQuery(placeStr, days){
  try{
    SONUCLAR.innerHTML = '<div class="card">Veriler çekiliyor…</div>';
    let lat=null, lon=null, placeName=placeStr;
    const coords = placeStr.split(',').map(s=>s.trim());
    if(coords.length===2 && !isNaN(Number(coords[0]))){
      lat = parseFloat(coords[0]); lon = parseFloat(coords[1]);
      placeName = `Koordinat: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    } else {
      const g = await geocodePlace(placeStr);
      lat=g.lat; lon=g.lon; placeName=g.display_name;
    }
    const [forecast, moon] = await Promise.all([
      fetchForecast(lat, lon, days),
      fetchMoon(lat, lon, days).catch(e => { console.warn(e); return null; })
    ]);
    const daily = computeDaily(forecast, moon);
    render(placeName, daily);
    lastQuery = { q:placeStr, days, lat, lon, updatedAt:new Date().toISOString() };
  } catch(err){
    SONUCLAR.innerHTML = `<div class="card">Hata: ${err.message || err}</div>`;
    console.error(err);
  }
}

// ---- Auto trigger ----
const autoHandler = debounce(()=>{
  if(!AUTO_SWITCH.checked) return;
  const place = (KONUM_INPUT.value || '').trim();
  const days  = Number(GUN_SELECT.value || 3);
  if(!place){ SONUCLAR.innerHTML = '<div class="card">Lütfen konum girin.</div>'; return; }
  if(lastQuery.q===place && lastQuery.days===days) return;
  doQuery(place, days);
}, 700);

KONUM_INPUT.addEventListener('input', autoHandler);
GUN_SELECT.addEventListener('change', autoHandler);
AUTO_SWITCH.addEventListener('change', ()=>{ if(AUTO_SWITCH.checked) autoHandler(); });

function tryUseBrowserLocation(){
  if(!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos)=>{
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    KONUM_INPUT.value = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    autoHandler();
  }, (err)=>{ console.log('Konum reddedildi:', err?.message); }, { timeout:5000 });
}

window.addEventListener('DOMContentLoaded', ()=>{
  if(!KONUM_INPUT.value || KONUM_INPUT.value.trim()==='') tryUseBrowserLocation();
  setTimeout(()=>autoHandler(), 300);
});
