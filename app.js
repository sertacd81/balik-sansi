/* app.js (kalıcı çözüm) – Open-Meteo forecast + Astronomy (moon) ayrı çağrı
   Özellikler:
   - Konum (adres ya da "lat,lon") ve Gün sayısı değişince otomatik fetch
   - Günlük kartlarda: skor, ort. rüzgar/basınç/sıcaklık, AY %, "en iyi 3 saat"
   - Nominatim (geocoding) + Open-Meteo Forecast (daily+hourly) + Astronomy (moon)
*/

const KONUM_INPUT = document.getElementById('konum');
const GUN_SELECT  = document.getElementById('gunSayisi');
const SONUCLAR    = document.getElementById('sonuclar');
const AUTO_SWITCH = document.getElementById('autoUpdate');

let lastQuery = { q:'', days:null, lat:null, lon:null };

function debounce(fn, wait=700){
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); };
}

// ---- Geocoding (adres -> lat/lon) ----
async function geocodePlace(place){
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(place)}&limit=1`;
  const res = await fetch(url, { headers: { 'Accept':'application/json' }});
  if(!res.ok) throw new Error('Konum servisine ulaşılamadı');
  const arr = await res.json();
  if(!arr || !arr.length) throw new Error('Konum bulunamadı');
  return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon), display_name: arr[0].display_name };
}

// ---- Forecast (daily+hourly) – moon_phase YOK, ayrı çağrılacak ----
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

// ---- Astronomy (moon_phase) – ayrı uç ----
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

// ---- Saatlik skor (0–100) ----
function hourlyScore(wind, pressure, temp){
  const wScore = Math.max(0, 100 - Math.abs(wind - 8)*6);     // ~8 km/s ideal
  const pScore = Math.max(0, 100 - Math.abs(pressure - 1015)); // ~1015 hPa ideal
  const tScore = Math.max(0, 100 - Math.abs(temp - 18)*5);     // 12–22°C iyi
  return Math.round(wScore*0.4 + pScore*0.3 + tScore*0.3);
}

// ---- Günlük verileri hesapla (moon ayrı veriyle birleştirilir) ----
function computeDaily(forecast, moonData){
  const out = [];
  const dates   = forecast.daily?.time || [];
  const hrTimes = forecast.hourly?.time || [];
  const hrWind  = forecast.hourly?.windspeed_10m || [];
  const hrPres  = forecast.hourly?.pressure_msl || [];
  const hrTemp  = forecast.hourly?.temperature_2m || [];

  // Moon map hazırlayalım (date -> 0..1)
  const moonMap = {};
  if(moonData?.daily?.time && moonData.daily.moon_phase){
    for(let i=0;i<moonData.daily.time.length;i++){
      moonMap[ moonData.daily.time[i] ] = Number(moonData.daily.moon_phase[i] ?? 0.5);
    }
  }

  for(let i=0;i<dates.length;i++){
    const date   = dates[i];
    const tmax   = forecast.daily?.temperature_2m_max?.[i] ?? null;
    const tmin   = forecast.daily?.temperature_2m_min?.[i] ?? null;

    // 05:00–21:00 arasından en iyi saatleri çıkar
    const hours = [];
    for(let j=0;j<hrTimes.length;j++){
      const t = hrTimes[j];
      if(t.startsWith(date)){
        const h = parseInt(t.slice(11,13));
        if(h>=5 && h<=21){
          const w = hrWind?.[j]; const p = hrPres?.[j]; const T = hrTemp?.[j];
          if(w!=null && p!=null && T!=null){
            hours.push({ hour: h, score: hourlyScore(w,p,T) });
          }
        }
      }
    }
    hours.sort((a,b)=> b.score - a.score);
    const top = hours.slice(0,3);
    const bestHours = top.map(h => String(h.hour).padStart(2,'0') + ':00');

    // Görüntüleme için ortalamalar
    const pick = (arr, idx) => (idx>=0 && idx < arr.length) ? arr[idx] : null;
    const findIndex = (H) => hrTimes.findIndex(tt => tt.startsWith(date) && parseInt(tt.slice(11,13))===H);
    const vals = (arr) => top.map(h => arr[ findIndex(h.hour) ]).filter(v=>v!=null);
    const avg  = (arr) => Math.round(arr.reduce((s,v)=>s+v,0)/arr.length);

    const windAvg = top.length ? avg(vals(hrWind)) : (null);
    const presAvg = top.length ? avg(vals(hrPres)) : (null);
    const tempAvg = top.length ? avg(vals(hrTemp)) : ((tmax!=null && tmin!=null) ? Math.round((tmax+tmin)/2) : null);

    // Ay yüzdesi (0..1 → 0..100), yoksa 50
    const moonP  = (moonMap[date] != null) ? moonMap[date] : 0.5;
    const moonPct = Math.round(moonP * 100);

    // Gün skoru: top-3 saat ortalaması %80 + ay etkisi %20
    const topAvg    = top.length ? Math.round(top.reduce((s,v)=>s+v.score,0)/top.length) : 50;
    const dayScore  = Math.round(topAvg*0.8 + moonPct*0.2);

    let label='Zayıf', color='#ef4444', badge='🔴 Zayıf';
    if(dayScore >= 70){ label='Harika gün'; color='#10b981'; badge='🟢 Harika'; }
    else if(dayScore >= 45){ label='Orta şans'; color='#f59e0b'; badge='🟠 Orta'; }

    out.push({
      date,
      dayScore, label, color, badge,
      windAvg: (windAvg ?? '-'),
      presAvg: (presAvg ?? '-'),
      tempAvg: (tempAvg ?? '-'),
      moonPct,
      bestHours
    });
  }

  return out;
}

// ---- Render ----
function render(placeName, arr){
  SONUCLAR.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'card';
  head.innerHTML = `<div><strong class="place">${placeName}</strong> — ${arr.length} gün</div>`;
  SONUCLAR.appendChild(head);

  arr.forEach(r=>{
    const el = document.createElement('div');
    el.className = 'card';
    el.style.borderColor = r.color;
    el.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <div>
          <div class="muted">${new Date(r.date).toLocaleDateString('tr-TR', { weekday:'short', day:'2-digit', month:'short' })}</div>
          <div class="badge" style="background:${r.color}22;color:${r.color}">${r.badge}</div>
        </div>
        <div style="text-align:right">
          <div class="score" style="color:${r.color}">${r.dayScore}</div>
          <div class="muted">${r.label}</div>
        </div>
      </div>
      <div class="hint">Rüzgar avg: ${r.windAvg} km/s • Basınç avg: ${r.presAvg} hPa • Sıcaklık avg: ${r.tempAvg}°C • Ay: ${r.moonPct}</div>
      <div class="hours"><span class="muted">En iyi saatler:</span> ${
        r.bestHours.length ? r.bestHours.map(h=>`<span class="chip">${h}</span>`).join('') : '<span class="chip">—</span>'
      }</div>
    `;
    SONUCLAR.appendChild(el);
  });
}

// ---- Sorgu akışı ----
async function doQuery(placeStr, days){
  try{
    SONUCLAR.innerHTML = '<div class="card">Veriler çekiliyor…</div>';

    // 1) Koordinat
    let lat=null, lon=null, placeName=placeStr;
    const coords = placeStr.split(',').map(s=>s.trim());
    if(coords.length===2 && !isNaN(Number(coords[0]))){
      lat = parseFloat(coords[0]); lon = parseFloat(coords[1]);
      placeName = `Koordinat: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    } else {
      const g = await geocodePlace(placeStr);
      lat=g.lat; lon=g.lon; placeName=g.display_name;
    }

    // 2) Forecast + Moon paralel çek
    const [forecast, moon] = await Promise.all([
      fetchForecast(lat, lon, days),
      fetchMoon(lat, lon, days).catch(e => { console.warn(e); return null; })
    ]);

    // 3) Hesapla + Göster
    const daily = computeDaily(forecast, moon);
    render(placeName, daily);
    lastQuery = { q:placeStr, days, lat, lon, updatedAt:new Date().toISOString() };

  } catch(err){
    SONUCLAR.innerHTML = `<div class="card">Hata: ${err.message || err}</div>`;
    console.error(err);
  }
}

// ---- Otomatik tetikleyici ----
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

// ---- İlk yüklemede mevcut değerle çalıştır ----
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
