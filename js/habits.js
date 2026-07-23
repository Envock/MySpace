import { supabase } from './supabaseClient.js';
import { state, setSync, paintSync } from './state.js';
import { screenHeader, esc } from './ui.js';

/* ============================================================
   Hábitos editáveis: cada hábito tem seu próprio nome, data de
   início e meta (data final opcional). O progresso é gravado por
   data real (log_date), não mais por um índice de dia fixo.
   ============================================================ */

const DIAS_SEMANA = ['dom','seg','ter','qua','qui','sex','sáb'];
const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const GRID_DAYS = 15; // janela da visão geral (últimos N dias)

let habitsList = [];   // [{id,name,start_date,end_date,archived}]
let logs = {};          // { habitId: { 'YYYY-MM-DD': true } }
let currentDate = todayDate();
let container = null;
let loaded = false;
let formState = null;   // null | 'new' | <habitId em edição>

/* ---------- datas ---------- */
function todayDate(){ const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function toISO(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0'); return y+'-'+m+'-'+dd; }
function fromISO(s){ const [y,m,dd] = s.split('-').map(Number); return new Date(y, m-1, dd); }
function addDays(d, n){ const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function isSameDay(a,b){ return toISO(a) === toISO(b); }

/* ---------- carga ---------- */
export async function render(el){
  container = el;
  paint();
  if(!loaded){
    await loadAll();
    loaded = true;
    if(state.currentTab === 'habits') paint();
  }
}

async function loadAll(){
  setSync('saving');
  const { data: h, error: he } = await supabase
    .from('habits').select('id,name,start_date,end_date,archived')
    .eq('archived', false).order('created_at', { ascending:true });
  if(he){ setSync('err'); return; }
  habitsList = h || [];

  const { data: rows, error: le } = await supabase.from('habit_log').select('habit_id,log_date,done');
  if(le){ setSync('err'); return; }
  logs = {};
  (rows||[]).forEach(r => { if(!logs[r.habit_id]) logs[r.habit_id] = {}; logs[r.habit_id][r.log_date] = r.done; });
  setSync('ok');
}

function isDoneOn(habitId, date){ return !!(logs[habitId] && logs[habitId][toISO(date)]); }

function computeStreak(habitId){
  let s = 0, d = todayDate();
  while(isDoneOn(habitId, d)){ s++; d = addDays(d,-1); }
  return s;
}

function dayInfo(h){
  const start = fromISO(h.start_date);
  const dayNum = Math.round((currentDate - start)/86400000) + 1;
  if(h.end_date){
    const end = fromISO(h.end_date);
    const total = Math.round((end - start)/86400000) + 1;
    return 'meta: ' + total + ' dias · dia ' + Math.max(dayNum,1) + '/' + total;
  }
  return dayNum >= 1 ? (computeStreak(h.id) > 0 ? computeStreak(h.id) + ' dia' + (computeStreak(h.id)>1?'s':'') + ' seguidos' : 'sem streak ainda') : 'começa em ' + h.start_date;
}

/* ---------- render ---------- */
function paint(){
  const dayLabel = DIAS_SEMANA[currentDate.getDay()] + ', ' + currentDate.getDate() + ' ' + MESES[currentDate.getMonth()];
  const isToday = isSameDay(currentDate, todayDate());

  let html = screenHeader('Hábitos', { addBtnId: 'habitAdd' });

  const total = habitsList.length;
  const done = habitsList.filter(h => isDoneOn(h.id, currentDate)).length;
  const pct = total ? Math.round((done/total)*100) : 0;
  const bestStreak = habitsList.reduce((m,h) => Math.max(m, computeStreak(h.id)), 0);

  html += '<div class="progress-row">';
  html += '<div class="stat"><div class="n">'+done+'/'+total+'</div><div class="l">no dia</div></div>';
  html += '<div class="stat"><div class="n">'+pct+'%</div><div class="l">aproveitamento</div></div>';
  html += '<div class="stat"><div class="n">'+bestStreak+'</div><div class="l">maior streak</div></div></div>';

  html += '<div class="daynav"><button id="prevBtn">‹</button>';
  html += '<div class="daylabel"><div class="d">'+dayLabel+'</div><div class="n">'+(isToday?'hoje':'')+'</div></div>';
  html += '<button id="nextBtn" '+(isToday?'disabled':'')+'>›</button></div>';
  if(!isToday) html += '<button class="today-btn" id="todayBtn">Voltar para hoje</button>';

  if(formState) html += renderForm();

  if(habitsList.length === 0){
    html += '<div class="empty">Nenhum hábito cadastrado.<br>Toque no + para criar o primeiro.</div>';
  } else {
    habitsList.forEach(h => {
      const on = isDoneOn(h.id, currentDate);
      html += '<div class="item '+(on?'done':'')+'" data-habit="'+h.id+'">'
            + '<div class="check">✓</div>'
            + '<div class="item-txt"><div class="item-name">'+esc(h.name)+'</div>'
            + '<div class="item-meta">'+dayInfo(h)+'</div></div>'
            + '<button class="item-action" data-edit="'+h.id+'" aria-label="Editar">✎</button>'
            + '</div>';
    });
  }

  html += '<div class="section-title">Últimos '+GRID_DAYS+' dias</div>';
  const days = []; for(let i=GRID_DAYS-1;i>=0;i--) days.push(addDays(todayDate(), -i));
  if(habitsList.length === 0){
    html += '<div class="empty">A visão geral aparece assim que você tiver hábitos cadastrados.</div>';
  } else {
    html += '<div class="grid-wrap"><table><thead><tr><th class="habit-col"></th>';
    days.forEach(d => { html += '<th'+(isSameDay(d,todayDate())?' style="color:var(--text-2);font-weight:600;"':'')+'>'+d.getDate()+'</th>'; });
    html += '</tr></thead><tbody>';
    habitsList.forEach(h => {
      html += '<tr><td class="habit-col">'+esc(h.name)+'</td>';
      days.forEach(d => {
        const on = isDoneOn(h.id, d);
        html += '<td><div class="cell '+(on?'on':'')+' '+(isSameDay(d,todayDate())?'today-col':'')+'" data-habit="'+h.id+'" data-date="'+toISO(d)+'"></div></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  }

  container.innerHTML = html;
  paintSync();
  bindEvents();
}

function renderForm(){
  const editing = formState !== 'new';
  const h = editing ? habitsList.find(x => x.id === formState) : null;
  const name = h ? h.name : '';
  const start = h ? h.start_date : toISO(todayDate());
  const end = h && h.end_date ? h.end_date : '';

  return '<div class="addform" id="habitForm">'
    + '<p class="field-label">Nome do hábito</p>'
    + '<input class="field" id="hName" value="'+esc(name)+'" placeholder="ex.: Treino">'
    + '<div class="row2">'
    +   '<div class="field"><p class="field-label">Início</p><input class="field" id="hStart" type="date" value="'+start+'"></div>'
    +   '<div class="field"><p class="field-label">Meta (opcional)</p><input class="field" id="hEnd" type="date" value="'+end+'"></div>'
    + '</div>'
    + '<div class="form-actions">'
    +   '<button class="btn-sm ghost" id="hCancel">Cancelar</button>'
    +   (editing ? '<button class="btn-sm ghost" id="hDelete" style="color:var(--danger);">Excluir</button>' : '')
    +   '<button class="btn-sm primary" id="hSave">Salvar</button>'
    + '</div>'
    + '</div>';
}

/* ---------- ações ---------- */
async function toggle(habitId, date){
  const iso = toISO(date);
  if(!logs[habitId]) logs[habitId] = {};
  logs[habitId][iso] = !logs[habitId][iso];
  const val = logs[habitId][iso];
  paint();
  setSync('saving');
  const { error } = await supabase.from('habit_log').upsert({
    user_id: state.user.id, habit_id: habitId, log_date: iso, done: val, updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,habit_id,log_date' });
  setSync(error ? 'err' : 'ok');
}

async function saveHabit(){
  const name = document.getElementById('hName').value.trim();
  const start = document.getElementById('hStart').value;
  const end = document.getElementById('hEnd').value || null;
  if(!name || !start) return;
  setSync('saving');
  if(formState === 'new'){
    const { data, error } = await supabase.from('habits')
      .insert({ user_id: state.user.id, name, start_date: start, end_date: end })
      .select('id,name,start_date,end_date,archived').single();
    if(error){ setSync('err'); return; }
    habitsList.push(data);
  } else {
    const { error } = await supabase.from('habits').update({ name, start_date: start, end_date: end }).eq('id', formState);
    if(error){ setSync('err'); return; }
    const h = habitsList.find(x => x.id === formState);
    h.name = name; h.start_date = start; h.end_date = end;
  }
  setSync('ok');
  formState = null;
  paint();
}

async function deleteHabit(){
  if(!confirm('Excluir este hábito e todo o histórico dele?')) return;
  setSync('saving');
  const { error } = await supabase.from('habits').delete().eq('id', formState);
  if(!error){ habitsList = habitsList.filter(x => x.id !== formState); delete logs[formState]; }
  setSync(error ? 'err' : 'ok');
  formState = null;
  paint();
}

function bindEvents(){
  document.getElementById('prevBtn').onclick = () => { currentDate = addDays(currentDate,-1); paint(); };
  const nextBtn = document.getElementById('nextBtn');
  if(!nextBtn.disabled) nextBtn.onclick = () => { currentDate = addDays(currentDate,1); paint(); };
  const tb = document.getElementById('todayBtn'); if(tb) tb.onclick = () => { currentDate = todayDate(); paint(); };

  document.getElementById('habitAdd').onclick = () => { formState = formState ? null : 'new'; paint(); };

  const form = document.getElementById('habitForm');
  if(form){
    document.getElementById('hCancel').onclick = () => { formState = null; paint(); };
    document.getElementById('hSave').onclick = saveHabit;
    const delBtn = document.getElementById('hDelete'); if(delBtn) delBtn.onclick = deleteHabit;
  }

  container.querySelectorAll('.item[data-habit]').forEach(elc => {
    elc.onclick = (e) => { if(e.target.closest('[data-edit]')) return; toggle(elc.getAttribute('data-habit'), currentDate); };
  });
  container.querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); formState = btn.getAttribute('data-edit'); paint(); };
  });
  container.querySelectorAll('.cell').forEach(elc => {
    elc.onclick = (e) => { e.stopPropagation(); toggle(elc.getAttribute('data-habit'), fromISO(elc.getAttribute('data-date'))); };
  });
}

export function resetHabitsState(){ habitsList = []; logs = {}; currentDate = todayDate(); loaded = false; formState = null; }