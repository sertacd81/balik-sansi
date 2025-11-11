/* v0.2: Otomatik güncelleme + Open-Meteo + Nominatim + Günlük en iyi avlanma saatleri (top 3)
*/
const KONUM_INPUT = document.getElementById('konum');
const GUN_SELECT = document.getElementById('gunSayisi');
const SONUCLAR = document.getElementById('sonuclar');
const AUTO_SWITCH = document.getElementById('autoUpdate');

let lastQuery = { q:'', days: null, lat: null, lon: null };

function debounce(fn, wait=700){
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); };
}

async function geocodePlace(place){
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(place)}&limit=1`;
  const res = await fetch(url, { headers: {'Accept':'application/json'} });
  if(!res.ok) throw new Error('Konum servisine ulaşılamadı');
  const arr = await res.json();
  if(!arr || arr.length===0) throw new Error('Konum bulunamadı');
  return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon), display_name: arr[0].display_name };
}

function datespan(days){
  const start = new Date();
  const end = new Date(start);
  end.setDate(start.getDate() + (days-1));
  return [start.toISOString().slice(0,10), end.toISOString().slice(0,10)];
}

async function fetchWeatherAndMoon(lat, lon, days){
  const dailyVars  = 'temperature_2m_max,temperature_2m_min,moon_phase';
  const hourlyVars = 'windspeed_10m,pressure_msl,temperature_2m';
  // start_date/end_date yerine forecast_days kullan: daha toleranslı
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&timezone=auto&forecast_days=${Math.max(1, Math.min(7, Number(days)||5))}` +
    `&daily=${dailyVars}&hourly=${hourlyVars}`;

  const res = await fetch(url, { mode: 'cors' });
  if(!res.ok){
    const txt = await res.text().catch(()=> '');
    throw new Error('Hava verisi alınamadı' + (txt ? ` (${txt.slice(0,120)}...)` : ''));
  }
  return await res.json();
}


function hourlyScore(wind, pressure, temp){
  let wScore = Math.max(0, 100 - Math.abs(wind - 8)*6);
  let pScore = Math.max(0, 100 - Math.abs(pressure - 1015));
  let tScore = Math.max(0, 100 - Math.abs(temp - 18)*5);
  return Math.round(wScore*0.4 + pScore*0.3 + tScore*0.3);
}

function computeDaily(api){
  const daily = [];
  const dates = api.daily.time || [];
  const hrTimes = api.hourly?.time || [];
  const hrWind = api.hourly?.windspeed_10m || [];
  const hrPres = api.hourly?.pressure_msl || [];
  const hrTemp = api.hourly?.temperature_2m || [];

  for(let i=0;i<dates.length;i++){
    const date = dates[i];
    const tmax = api.daily.temperature_2m_max?.[i] ?? null;
    const tmin = api.daily.temperature_2m_min?.[i] ?? null;
    const moonP = api.daily.moon_phase?.[i] ?? 0.5;

    const hours = [];
    for(let j=0;j<hrTimes.length;j++){
      const t = hrTimes[j];
      if(t.startsWith(date)){
        const hour = parseInt(t.slice(11,13));
        if(hour>=5 && hour<=21){
          const w = hrWind?.[j]; const p = hrPres?.[j]; const T = hrTemp?.[j];
          if(w!=null && p!=null && T!=null){
            hours.push({ hour, score: hourlyScore(w,p,T) });
          }
        }
      }
    }

    hours.sort((a,b)=>b.score - a.score);
    const top = hours.slice(0,3);
    const bestHours = top.map(h => String(h.hour).padStart(2,'0') + ':00');

    const avg = arr => Math.round(arr.reduce((s,v)=>s+v,0)/arr.length);
    const findHour = (H) => hrTimes.findIndex(tt => tt.startsWith(date) && parseInt(tt.slice(11,13))===H);
    const dayWinds = top.map(h => hrWind[findHour(h.hour)]).filter(v=>v!=null);
    const dayPres = top.map(h => hrPres[findHour(h.hour)]).filter(v=>v!=null);
    const dayTemp = top.map(h => hrTemp[findHour(h.hour)]).filter(v=>v!=null);
    const windAvg = dayWinds.length? avg(dayWinds): null;
    const presAvg = dayPres.length? avg(dayPres): null;
    const tempAvg = dayTemp.length? avg(dayTemp): ((tmax!=null&&tmin!=null)? Math.round((tmax+tmin)/2): null);

    const topAvg = top.length? Math.round(top.reduce((s,v)=>s+v.score,0)/top.length): 50;
    const moonScore = Math.round(moonP * 100);
    const dayScore = Math.round(topAvg*0.8 + moonScore*0.2);

    let label='Zayıf', color='#ef4444', badge='🔴 Zayıf';
    if(dayScore>=70){ label='Harika gün'; color='#10b981'; badge='🟢 Harika'; }
    else if(dayScore>=45){ label='Orta şans'; color='#f59e0b'; badge='🟠 Orta'; }

    daily.push({
      date, dayScore, label, color, badge,
      windAvg: windAvg ?? '-', presAvg: presAvg ?? '-', tempAvg: tempAvg ?? '-',
      moonPct: Math.round(moonP*100),
      bestHours
    });
  }

  return daily;
}

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
      <div class="hours"><span class="muted">En iyi saatler:</span> ${
        r.bestHours.length? r.bestHours.map(h=>`<span class="chip">${h}</span>`).join('') : '<span class="chip">—</span>'
      }</div>
    `;
    SONUCLAR.appendChild(el);
  });
}

async function doQuery(placeStr, days){
  try{
    SONUCLAR.innerHTML = '<div class="card">Veriler çekiliyor…</div>';
    let lat=null, lon=null, placeName = placeStr;
    const coords = placeStr.split(',').map(s=>s.trim());
    if(coords.length===2 && !isNaN(Number(coords[0]))){
      lat = parseFloat(coords[0]); lon = parseFloat(coords[1]);
      placeName = `Koordinat: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    }else{
      const g = await geocodePlace(placeStr);
      lat=g.lat; lon=g.lon; placeName=g.display_name;
    }
    const api = await fetchWeatherAndMoon(lat, lon, days);
    const daily = computeDaily(api);
    render(placeName, daily);
    lastQuery = { q:placeStr, days, lat, lon, updatedAt: new Date().toISOString() };
  }catch(err){
    SONUCLAR.innerHTML = `<div class="card">Hata: ${err.message || err}</div>`;
    console.error(err);
  }
}

const autoHandler = debounce(()=>{
  if(!AUTO_SWITCH.checked) return;
  const place = KONUM_INPUT.value.trim();
  const days = Number(GUN_SELECT.value || 3);
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
