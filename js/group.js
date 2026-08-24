import { supabase } from './supabaseClient.js';
import { state, setSync, paintSync } from './state.js';
import { screenHeader, esc } from './ui.js';

/* ============================================================
   Grupo — tarefas compartilhadas da casa (ex.: "dar comida pro
   cachorro"). Um usuário pertence a um único grupo. Dentro do
   grupo, qualquer membro cria tarefas e marca/desmarca o dia;
   todo mundo vê quem marcou e quando.
   ============================================================ */

const DIAS_SEMANA = ['dom','seg','ter','qua','qui','sex','sáb'];
const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

let group = null;          // {id,name,invite_code,owner_id} | null
let members = [];          // [{user_id,display_name}]
let tasks = [];            // [{id,name,archived}]
let logs = {};             // { taskId: { 'YYYY-MM-DD': {done,done_by,updated_at} } }
let currentDate = todayDate();
let container = null;
let loaded = false;
let entryMode = null;      // null | 'create' | 'join'  (tela sem grupo)
let formState = null;      // null | 'new' | <taskId em edição>

/* ---------- datas ---------- */
function todayDate(){ const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function toISO(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0'); return y+'-'+m+'-'+dd; }
function fromISO(s){ const [y,m,dd] = s.split('-').map(Number); return new Date(y, m-1, dd); }
function addDays(d, n){ const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function isSameDay(a,b){ return toISO(a) === toISO(b); }
function fmtTime(iso){ return new Date(iso).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }); }
function myDisplayName(){ return state.user.user_metadata?.full_name || state.user.user_metadata?.name || state.user.email; }

/* ---------- carga ---------- */
export async function render(el){
  container = el;
  paint();
  if(!loaded){
    await loadAll();
    loaded = true;
    if(state.currentTab === 'group') paint();
  }
}

async function loadAll(){
  setSync('saving');
  const { data: mrow, error: me } = await supabase
    .from('group_members').select('group_id').eq('user_id', state.user.id).limit(1).maybeSingle();
  if(me){ setSync('err'); return; }

  if(!mrow){ group = null; setSync('ok'); return; }

  const { data: g, error: ge } = await supabase
    .from('groups').select('id,name,invite_code,owner_id').eq('id', mrow.group_id).single();
  if(ge){ setSync('err'); return; }
  group = g;

  await loadGroupData();
  setSync('ok');
}

async function loadGroupData(){
  const [{ data: mem, error: meErr }, { data: tk, error: tkErr }, { data: lg, error: lgErr }] = await Promise.all([
    supabase.from('group_members').select('user_id,display_name').eq('group_id', group.id),
    supabase.from('group_tasks').select('id,name,archived').eq('group_id', group.id).eq('archived', false).order('created_at', { ascending:true }),
    supabase.from('group_task_log').select('task_id,log_date,done,done_by,updated_at').eq('group_id', group.id),
  ]);
  if(meErr || tkErr || lgErr) throw (meErr || tkErr || lgErr);
  members = mem || [];
  tasks = tk || [];
  logs = {};
  (lg||[]).forEach(r => { if(!logs[r.task_id]) logs[r.task_id] = {}; logs[r.task_id][r.log_date] = r; });
}

function memberName(userId){
  if(userId === state.user.id) return 'você';
  const m = members.find(x => x.user_id === userId);
  return m ? m.display_name : 'alguém';
}

/* ---------- render ---------- */
function paint(){
  if(!group){ paintNoGroup(); return; }
  paintGroup();
}

function paintNoGroup(){
  let html = screenHeader('Grupo');
  html += '<div class="placeholder">'
    +   '<div class="pico">👥</div>'
    +   '<div class="ptitle">Você ainda não tem um grupo</div>'
    +   '<div class="pdesc">Crie um grupo para a casa ou entre com o código de convite de quem já tem um.</div>'
    + '</div>';

  html += '<div class="form-actions" style="margin-bottom:14px;">'
    +   '<button class="btn-sm '+(entryMode==='create'?'primary':'ghost')+'" id="modeCreate">Criar grupo</button>'
    +   '<button class="btn-sm '+(entryMode==='join'?'primary':'ghost')+'" id="modeJoin">Tenho um código</button>'
    + '</div>';

  if(entryMode === 'create'){
    html += '<div class="addform" id="createForm">'
      +   '<p class="field-label">Nome do grupo</p>'
      +   '<input class="field" id="gName" placeholder="ex.: Apê da Vila Madalena">'
      +   '<div class="form-actions">'
      +     '<button class="btn-sm ghost" id="gCancel">Cancelar</button>'
      +     '<button class="btn-sm primary" id="gCreateSave">Criar</button>'
      +   '</div>'
      + '</div>';
  } else if(entryMode === 'join'){
    html += '<div class="addform" id="joinForm">'
      +   '<p class="field-label">Código de convite</p>'
      +   '<input class="field" id="gCode" placeholder="ex.: A1B2C3" style="text-transform:uppercase;">'
      +   '<div class="form-actions">'
      +     '<button class="btn-sm ghost" id="gCancel2">Cancelar</button>'
      +     '<button class="btn-sm primary" id="gJoinSave">Entrar</button>'
      +   '</div>'
      + '</div>';
  }

  container.innerHTML = html;
  paintSync();

  document.getElementById('modeCreate').onclick = () => { entryMode = entryMode==='create' ? null : 'create'; paint(); };
  document.getElementById('modeJoin').onclick = () => { entryMode = entryMode==='join' ? null : 'join'; paint(); };

  const cf = document.getElementById('createForm');
  if(cf){
    document.getElementById('gCancel').onclick = () => { entryMode = null; paint(); };
    document.getElementById('gCreateSave').onclick = createGroup;
  }
  const jf = document.getElementById('joinForm');
  if(jf){
    document.getElementById('gCancel2').onclick = () => { entryMode = null; paint(); };
    document.getElementById('gJoinSave').onclick = joinGroup;
  }
}

function paintGroup(){
  const dayLabel = DIAS_SEMANA[currentDate.getDay()] + ', ' + currentDate.getDate() + ' ' + MESES[currentDate.getMonth()];
  const isToday = isSameDay(currentDate, todayDate());

  let html = screenHeader('Grupo', { subtitle: group.name, addBtnId: 'taskAdd' });

  const total = tasks.length;
  const doneCount = tasks.filter(t => isDoneOn(t.id, currentDate)).length;
  const pct = total ? Math.round((doneCount/total)*100) : 0;

  html += '<div class="progress-row">';
  html += '<div class="stat"><div class="n">'+doneCount+'/'+total+'</div><div class="l">no dia</div></div>';
  html += '<div class="stat"><div class="n">'+pct+'%</div><div class="l">concluído</div></div>';
  html += '<div class="stat"><div class="n">'+members.length+'</div><div class="l">'+(members.length===1?'membro':'membros')+'</div></div></div>';

  html += '<div class="fin-budget" style="margin-bottom:14px;">'
    +   '<div class="fin-budget-top"><span>código de convite</span></div>'
    +   '<div class="fin-budget-amt" style="letter-spacing:.08em;">'+esc(group.invite_code)+'</div>'
    +   '<div class="fin-budget-sub">compartilhe com quem mora com você</div>'
    + '</div>';

  html += '<div class="daynav"><button id="prevBtn">‹</button>';
  html += '<div class="daylabel"><div class="d">'+dayLabel+'</div><div class="n">'+(isToday?'hoje':'')+'</div></div>';
  html += '<button id="nextBtn" '+(isToday?'disabled':'')+'>›</button></div>';
  if(!isToday) html += '<button class="today-btn" id="todayBtn">Voltar para hoje</button>';

  if(formState) html += renderForm();

  if(tasks.length === 0){
    html += '<div class="empty">Nenhuma tarefa compartilhada ainda.<br>Toque no + para criar a primeira.</div>';
  } else {
    tasks.forEach(t => {
      const on = isDoneOn(t.id, currentDate);
      html += '<div class="item '+(on?'done':'')+'" data-task="'+t.id+'">'
            + '<div class="check">✓</div>'
            + '<div class="item-txt"><div class="item-name">'+esc(t.name)+'</div>'
            + '<div class="item-meta">'+metaFor(t.id)+'</div></div>'
            + '<button class="item-action" data-edit="'+t.id+'" aria-label="Editar">✎</button>'
            + '</div>';
    });
  }

  html += '<div class="section-title">Membros</div>';
  html += '<div class="group-members">'
    + members.map(m => '<div class="member-row"><span class="member-dot"></span>'
        + esc(m.user_id === state.user.id ? m.display_name + ' (você)' : m.display_name) + '</div>').join('')
    + '</div>';

  html += '<button class="btn btn-ghost" id="leaveBtn" style="margin-top:18px;color:var(--danger);">Sair do grupo</button>';

  container.innerHTML = html;
  paintSync();
  bindEvents();
}

function isDoneOn(taskId, date){ const l = logs[taskId] && logs[taskId][toISO(date)]; return !!(l && l.done); }

function metaFor(taskId){
  const l = logs[taskId] && logs[taskId][toISO(currentDate)];
  if(l && l.done) return 'feito por '+memberName(l.done_by)+(l.updated_at ? ' · '+fmtTime(l.updated_at) : '');
  return 'ainda não feito';
}

function renderForm(){
  const editing = formState !== 'new';
  const t = editing ? tasks.find(x => x.id === formState) : null;
  const name = t ? t.name : '';

  return '<div class="addform" id="taskForm">'
    + '<p class="field-label">Nome da tarefa</p>'
    + '<input class="field" id="tName" value="'+esc(name)+'" placeholder="ex.: Dar comida pro cachorro">'
    + '<div class="form-actions">'
    +   '<button class="btn-sm ghost" id="tCancel">Cancelar</button>'
    +   (editing ? '<button class="btn-sm ghost" id="tDelete" style="color:var(--danger);">Excluir</button>' : '')
    +   '<button class="btn-sm primary" id="tSave">Salvar</button>'
    + '</div>'
    + '</div>';
}

/* ---------- ações: entrada no grupo ---------- */
async function createGroup(){
  const name = document.getElementById('gName').value.trim();
  if(!name) return;
  setSync('saving');
  const { data, error } = await supabase.rpc('create_group', { p_name: name, p_display_name: myDisplayName() });
  if(error){ setSync('err'); alert('Não foi possível criar o grupo: '+error.message); return; }
  group = data;
  entryMode = null;
  await loadGroupData();
  setSync('ok');
  paint();
}

async function joinGroup(){
  const code = document.getElementById('gCode').value.trim();
  if(!code) return;
  setSync('saving');
  const { data, error } = await supabase.rpc('join_group_by_code', { p_code: code, p_display_name: myDisplayName() });
  if(error){ setSync('err'); alert('Não foi possível entrar no grupo: '+error.message); return; }
  group = data;
  entryMode = null;
  await loadGroupData();
  setSync('ok');
  paint();
}

async function leaveGroup(){
  if(!confirm('Sair do grupo "'+group.name+'"?')) return;
  setSync('saving');
  const { error } = await supabase.from('group_members').delete().eq('group_id', group.id).eq('user_id', state.user.id);
  if(error){ setSync('err'); return; }
  group = null; members = []; tasks = []; logs = {}; currentDate = todayDate(); formState = null;
  setSync('ok');
  paint();
}

/* ---------- ações: tarefas ---------- */
async function toggle(taskId, date){
  const iso = toISO(date);
  const wasDone = isDoneOn(taskId, date);
  const newDone = !wasDone;
  if(!logs[taskId]) logs[taskId] = {};
  logs[taskId][iso] = { task_id: taskId, log_date: iso, done: newDone, done_by: newDone ? state.user.id : null, updated_at: new Date().toISOString() };
  paint();
  setSync('saving');
  const { error } = await supabase.from('group_task_log').upsert({
    group_id: group.id, task_id: taskId, log_date: iso,
    done: newDone, done_by: newDone ? state.user.id : null, updated_at: new Date().toISOString(),
  }, { onConflict: 'task_id,log_date' });
  setSync(error ? 'err' : 'ok');
}

async function saveTask(){
  const name = document.getElementById('tName').value.trim();
  if(!name) return;
  setSync('saving');
  if(formState === 'new'){
    const { data, error } = await supabase.from('group_tasks')
      .insert({ group_id: group.id, name })
      .select('id,name,archived').single();
    if(error){ setSync('err'); return; }
    tasks.push(data);
  } else {
    const { error } = await supabase.from('group_tasks').update({ name }).eq('id', formState);
    if(error){ setSync('err'); return; }
    const t = tasks.find(x => x.id === formState);
    t.name = name;
  }
  setSync('ok');
  formState = null;
  paint();
}

async function deleteTask(){
  if(!confirm('Excluir esta tarefa e todo o histórico dela?')) return;
  setSync('saving');
  const { error } = await supabase.from('group_tasks').delete().eq('id', formState);
  if(!error){ tasks = tasks.filter(x => x.id !== formState); delete logs[formState]; }
  setSync(error ? 'err' : 'ok');
  formState = null;
  paint();
}

function bindEvents(){
  document.getElementById('prevBtn').onclick = () => { currentDate = addDays(currentDate,-1); paint(); };
  const nextBtn = document.getElementById('nextBtn');
  if(!nextBtn.disabled) nextBtn.onclick = () => { currentDate = addDays(currentDate,1); paint(); };
  const tb = document.getElementById('todayBtn'); if(tb) tb.onclick = () => { currentDate = todayDate(); paint(); };

  document.getElementById('taskAdd').onclick = () => { formState = formState ? null : 'new'; paint(); };

  const form = document.getElementById('taskForm');
  if(form){
    document.getElementById('tCancel').onclick = () => { formState = null; paint(); };
    document.getElementById('tSave').onclick = saveTask;
    const delBtn = document.getElementById('tDelete'); if(delBtn) delBtn.onclick = deleteTask;
  }

  container.querySelectorAll('.item[data-task]').forEach(elc => {
    elc.onclick = (e) => { if(e.target.closest('[data-edit]')) return; toggle(elc.getAttribute('data-task'), currentDate); };
  });
  container.querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); formState = btn.getAttribute('data-edit'); paint(); };
  });

  document.getElementById('leaveBtn').onclick = leaveGroup;
}

export function resetGroupState(){
  group = null; members = []; tasks = []; logs = {};
  currentDate = todayDate(); loaded = false; entryMode = null; formState = null;
}
