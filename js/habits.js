import { supabase } from './supabaseClient.js';
import { state, setSync, paintSync } from './state.js';
import { screenHeader } from './ui.js';

/* ============================================================
   Configuração do desafio (por enquanto fixa, como no original).
   Próximo passo do projeto: tornar os hábitos editáveis, movendo
   esta lista para uma tabela no Supabase.
   ============================================================ */
const HABITS = [
  {id:'ig',       name:'Sem Instagram/TikTok'},
  {id:'creatina', name:'Creatina 5g'},
  {id:'treino',   name:'Treino'},
  {id:'alcool',   name:'Sem álcool'},
  {id:'estacio',  name:'Aula da Estácio'}
];
const START = new Date(2026,6,15);
const NUM_DAYS = 30;
const DIAS_SEMANA = ['dom','seg','ter','qua','qui','sex','sáb'];
const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

let data = {};
let currentDay = todayIndex();
let container = null;
let loaded = false;

/* ---------- datas ---------- */
function dateAt(i){ const d = new Date(START); d.setDate(d.getDate()+i); return d; }
function todayIndex(){
  const now = new Date();
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((t - START)/86400000);
  return Math.min(Math.max(diff,0), NUM_DAYS-1);
}

/* ---------- cache local ---------- */
function lsKey(){ return 'desafio30-cache-' + (state.user ? state.user.id : 'anon'); }
function cacheLocal(){ try{ localStorage.setItem(lsKey(), JSON.stringify(data)); }catch(e){} }
function loadLocal(){ try{ const r = localStorage.getItem(lsKey()); data = r ? JSON.parse(r) : {}; }catch(e){ data = {}; } }
function getDay(i){ if(!data[i]) data[i] = {}; return data[i]; }

/* ---------- sincronização com o Supabase ---------- */
async function loadCloud(){
  const { data: rows, error } = await supabase.from('habit_log').select('day_index,habit_id,done');
  if(error){ setSync('err'); return; }
  const fresh = {};
  rows.forEach(r => { if(!fresh[r.day_index]) fresh[r.day_index] = {}; fresh[r.day_index][r.habit_id] = r.done; });
  data = fresh; cacheLocal(); setSync('ok');
}
async function pushCloud(day, habitId, done){
  setSync('saving');
  const { error } = await supabase.from('habit_log').upsert({
    user_id: state.user.id, day_index: day, habit_id: habitId, done: done, updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,day_index,habit_id' });
  setSync(error ? 'err' : 'ok');
}

/* ---------- cálculos ---------- */
function computeStreak(habitId){
  let s = 0;
  for(let i = todayIndex(); i >= 0; i--){ if(data[i] && data[i][habitId]) s++; else break; }
  return s;
}
function computeTotals(){
  let done=0,total=0; const tIdx=todayIndex();
  for(let i=0;i<=tIdx;i++){ const d=getDay(i); HABITS.forEach(h=>{ total++; if(d[h.id]) done++; }); }
  return { pct: total ? Math.round((done/total)*100) : 0 };
}

/* ---------- render ---------- */
export async function render(el){
  container = el;
  if(!loaded){ loadLocal(); }
  paint();
  if(!loaded){
    loaded = true;
    await loadCloud();
    if(state.currentTab === 'habits') paint();
  }
}

function paint(){
  const tIdx = todayIndex();
  const totals = computeTotals();
  const d = dateAt(currentDay);
  const dayData = getDay(currentDay);
  const dayLabel = DIAS_SEMANA[d.getDay()] + ', ' + d.getDate() + ' ' + MESES[d.getMonth()];

  let html = screenHeader('Hábitos', { subtitle: '15 jul – 13 ago 2026' });

  html += '<div class="progress-row">';
  html += '<div class="stat"><div class="n">'+(tIdx+1)+'/30</div><div class="l">dia</div></div>';
  html += '<div class="stat"><div class="n">'+totals.pct+'%</div><div class="l">aproveitamento</div></div>';
  html += '<div class="stat"><div class="n">'+computeStreak('treino')+'</div><div class="l">streak treino</div></div></div>';

  html += '<div class="daynav"><button id="prevBtn" '+(currentDay<=0?'disabled':'')+'>‹</button>';
  html += '<div class="daylabel"><div class="d">'+dayLabel+'</div><div class="n">dia '+(currentDay+1)+' de 30</div></div>';
  html += '<button id="nextBtn" '+(currentDay>=NUM_DAYS-1?'disabled':'')+'>›</button></div>';
  if(currentDay !== tIdx) html += '<button class="today-btn" id="todayBtn">Voltar para hoje</button>';

  HABITS.forEach(h => {
    const on = !!dayData[h.id]; const s = computeStreak(h.id);
    html += '<div class="item '+(on?'done':'')+'" data-habit="'+h.id+'"><div class="check">✓</div>';
    html += '<div class="item-txt"><div class="item-name">'+h.name+'</div>';
    html += '<div class="item-meta">'+(s>0 ? s+' dia'+(s>1?'s':'')+' seguidos' : 'sem streak ainda')+'</div></div></div>';
  });

  html += '<div class="section-title">Visão geral dos 30 dias</div>';
  html += '<div class="grid-wrap"><table><thead><tr><th class="habit-col"></th>';
  for(let i=0;i<NUM_DAYS;i++){ html += '<th'+(i===tIdx?' style="color:var(--text-2);font-weight:600;"':'')+'>'+dateAt(i).getDate()+'</th>'; }
  html += '</tr></thead><tbody>';
  HABITS.forEach(h => {
    html += '<tr><td class="habit-col">'+h.name.replace('Sem ','').replace('Aula da ','')+'</td>';
    for(let i=0;i<NUM_DAYS;i++){ const on=!!getDay(i)[h.id]; html += '<td><div class="cell '+(on?'on':'')+' '+(i===tIdx?'today-col':'')+'" data-habit="'+h.id+'" data-day="'+i+'"></div></td>'; }
    html += '</tr>';
  });
  html += '</tbody></table></div>';

  html += '<button class="linkbtn" id="resetBtn" style="margin-top:16px;">limpar dados dos hábitos</button>';

  container.innerHTML = html;
  paintSync();

  document.getElementById('prevBtn').onclick = () => { if(currentDay>0){currentDay--; paint();} };
  document.getElementById('nextBtn').onclick = () => { if(currentDay<NUM_DAYS-1){currentDay++; paint();} };
  const tb = document.getElementById('todayBtn'); if(tb) tb.onclick = () => { currentDay = tIdx; paint(); };

  container.querySelectorAll('.item[data-habit]').forEach(elc => {
    elc.onclick = () => toggle(elc.getAttribute('data-habit'), currentDay);
  });
  container.querySelectorAll('.cell').forEach(elc => {
    elc.onclick = (e) => { e.stopPropagation(); toggle(elc.getAttribute('data-habit'), parseInt(elc.getAttribute('data-day'))); };
  });
  document.getElementById('resetBtn').onclick = async () => {
    if(confirm('Apagar todo o seu progresso dos hábitos?')){
      data={}; cacheLocal(); paint();
      setSync('saving');
      await supabase.from('habit_log').delete().eq('user_id', state.user.id);
      setSync('ok');
    }
  };
}

async function toggle(hid, day){
  const dd = getDay(day); dd[hid] = !dd[hid];
  cacheLocal(); paint();
  await pushCloud(day, hid, dd[hid]);
}

/* Limpa o cache em memória ao trocar de usuário (logout/login). */
export function resetHabitsState(){ data = {}; currentDay = todayIndex(); loaded = false; }
