import { supabase } from './supabaseClient.js';
import { state, setSync, paintSync } from './state.js';
import { screenHeader, esc } from './ui.js';

/* ============================================================
   Grupo — tarefas compartilhadas da casa (ex.: "dar comida pro
   cachorro"). Uma pessoa pode participar de vários grupos. Cada
   grupo tem hierarquia (dono > admin > membro) e pode ser aberto
   (qualquer um com o código entra na hora) ou fechado (precisa
   ser aprovado). Tarefas podem ser diárias, várias vezes ao dia
   ou semanais.
   ============================================================ */

const DIAS_SEMANA = ['dom','seg','ter','qua','qui','sex','sáb'];
const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const GRID_DAYS = 15;

let myMemberships = [];    // [{group_id,role,status,group:{id,name,invite_code,owner_id,is_open}}]
let activeGroupId = null;
let members = [];          // membros do grupo ativo: [{user_id,display_name,role,status,joined_at}]
let tasks = [];            // [{id,name,archived,freq_type,freq_count}]
let logs = {};             // { taskId: { dateKey: {count,done_by,updated_at} } }
let currentDate = todayDate();
let container = null;
let loaded = false;
let entryMode = null;      // null | 'create' | 'join'
let newGroupOpen = true;
let formState = null;      // null | 'new' | <taskId em edição>
let formName = '';
let formFreq = { type: 'daily', count: 2 };
let view = 'tasks';        // 'tasks' | 'org'

/* ---------- datas ---------- */
function todayDate(){ const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function toISO(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0'); return y+'-'+m+'-'+dd; }
function fromISO(s){ const [y,m,dd] = s.split('-').map(Number); return new Date(y, m-1, dd); }
function addDays(d, n){ const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function isSameDay(a,b){ return toISO(a) === toISO(b); }
function fmtTime(iso){ return new Date(iso).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }); }
function myDisplayName(){ return state.user.user_metadata?.full_name || state.user.user_metadata?.name || state.user.email; }
function mondayKey(d){ const day = d.getDay(); const diff = day===0 ? -6 : 1-day; return toISO(addDays(d, diff)); }
function computeWeekGroups(days){
  const groups = [];
  days.forEach(d => {
    const key = mondayKey(d);
    const last = groups[groups.length-1];
    if(!last || last.key !== key) groups.push({ key, span: 1 });
    else last.span++;
  });
  return groups;
}

/* ---------- frequência ---------- */
function targetFor(task){ return task.freq_type === 'multi_daily' ? task.freq_count : 1; }
function keyForDate(task, date){ return task.freq_type === 'weekly' ? mondayKey(date) : toISO(date); }
function countAt(task, date){ const l = logs[task.id] && logs[task.id][keyForDate(task, date)]; return l ? l.count : 0; }
function isDoneAt(task, date){ return countAt(task, date) >= targetFor(task); }
function freqLabel(t){ return t.freq_type === 'multi_daily' ? t.freq_count+'x/dia' : t.freq_type === 'weekly' ? '1x/semana' : ''; }
function roleLabel(r){ return r === 'owner' ? 'Dono' : r === 'admin' ? 'Admin' : 'Membro'; }

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

function activeMembership(){ return myMemberships.find(m => m.group_id === activeGroupId) || null; }

async function loadAll(){
  setSync('saving');
  const { data: mrows, error } = await supabase
    .from('group_members')
    .select('group_id,role,status,groups(id,name,invite_code,owner_id,is_open)')
    .eq('user_id', state.user.id);
  if(error){ setSync('err'); return; }
  myMemberships = (mrows||[]).map(r => ({ group_id:r.group_id, role:r.role, status:r.status, group:r.groups }));
  if(!activeGroupId || !myMemberships.some(m => m.group_id === activeGroupId)){
    activeGroupId = (myMemberships.find(m => m.status === 'active') || myMemberships[0] || {}).group_id || null;
  }
  if(activeGroupId){
    try{ await loadGroupData(activeGroupId); } catch(e){ setSync('err'); return; }
  }
  setSync('ok');
}

async function loadGroupData(gid){
  const membership = myMemberships.find(m => m.group_id === gid);
  if(!membership || membership.status !== 'active'){ members = []; tasks = []; logs = {}; return; }
  const [{ data: mem, error: meErr }, { data: tk, error: tkErr }, { data: lg, error: lgErr }] = await Promise.all([
    supabase.from('group_members').select('user_id,display_name,role,status,joined_at').eq('group_id', gid),
    supabase.from('group_tasks').select('id,name,archived,freq_type,freq_count').eq('group_id', gid).eq('archived', false).order('created_at', { ascending:true }),
    supabase.from('group_task_log').select('task_id,log_date,count,done_by,updated_at').eq('group_id', gid),
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
  if(myMemberships.length === 0){ paintNoGroup(); return; }
  paintGroup();
}

function paintNoGroup(){
  let html = screenHeader('Grupo');
  html += '<div class="placeholder">'
    +   '<div class="pico">👥</div>'
    +   '<div class="ptitle">Você ainda não tem um grupo</div>'
    +   '<div class="pdesc">Crie um grupo ou entre com o código de convite de quem já tem um.</div>'
    + '</div>';
  html += entryFormHtml();
  container.innerHTML = html;
  paintSync();
  bindEntryEvents();
}

function entryFormHtml(){
  let html = '<div class="form-actions" style="margin-bottom:14px;">'
    +   '<button class="btn-sm '+(entryMode==='create'?'primary':'ghost')+'" id="modeCreate">Criar grupo</button>'
    +   '<button class="btn-sm '+(entryMode==='join'?'primary':'ghost')+'" id="modeJoin">Tenho um código</button>'
    + '</div>';

  if(entryMode === 'create'){
    html += '<div class="addform" id="createForm">'
      +   '<p class="field-label">Nome do grupo</p>'
      +   '<input class="field" id="gName" placeholder="ex.: Apê da Vila Madalena">'
      +   '<p class="field-label">Tipo</p>'
      +   '<div class="form-actions" style="margin-bottom:8px;">'
      +     '<button class="btn-sm '+(newGroupOpen?'primary':'ghost')+'" id="gOpenBtn">Aberto</button>'
      +     '<button class="btn-sm '+(!newGroupOpen?'primary':'ghost')+'" id="gClosedBtn">Fechado</button>'
      +   '</div>'
      +   '<p class="item-meta" style="margin:-2px 0 12px 2px;">'+(newGroupOpen ? 'Qualquer pessoa com o código entra direto.' : 'Novas entradas precisam ser aprovadas por você.')+'</p>'
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
  return html;
}

function bindEntryEvents(){
  document.getElementById('modeCreate').onclick = () => { entryMode = entryMode==='create' ? null : 'create'; newGroupOpen = true; paint(); };
  document.getElementById('modeJoin').onclick = () => { entryMode = entryMode==='join' ? null : 'join'; paint(); };

  const cf = document.getElementById('createForm');
  if(cf){
    document.getElementById('gCancel').onclick = () => { entryMode = null; paint(); };
    document.getElementById('gOpenBtn').onclick = () => { newGroupOpen = true; paint(); };
    document.getElementById('gClosedBtn').onclick = () => { newGroupOpen = false; paint(); };
    document.getElementById('gCreateSave').onclick = createGroup;
  }
  const jf = document.getElementById('joinForm');
  if(jf){
    document.getElementById('gCancel2').onclick = () => { entryMode = null; paint(); };
    document.getElementById('gJoinSave').onclick = joinGroup;
  }
}

function switcherHtml(){
  let html = '<div class="group-switch">';
  myMemberships.forEach(m => {
    const active = m.group_id === activeGroupId;
    const pending = m.status === 'pending';
    html += '<button class="gchip'+(active?' active':'')+(pending?' pending':'')+'" data-switch="'+m.group_id+'">'
          + esc(m.group.name) + (pending?' <span class="pill-pending">pendente</span>':'')
          + '</button>';
  });
  html += '<button class="gchip add" id="gAddMore">+ grupo</button>';
  html += '</div>';
  return html;
}

function bindSwitcherEvents(){
  container.querySelectorAll('[data-switch]').forEach(btn => {
    btn.onclick = () => switchGroup(btn.getAttribute('data-switch'));
  });
  document.getElementById('gAddMore').onclick = () => { entryMode = entryMode ? null : 'create'; newGroupOpen = true; paint(); };
}

function paintGroup(){
  const am = activeMembership();
  if(!am){ paintNoGroup(); return; }

  if(entryMode){
    let html = screenHeader('Grupo', { subtitle: 'Novo grupo' });
    html += switcherHtml();
    html += entryFormHtml();
    container.innerHTML = html;
    paintSync();
    bindSwitcherEvents();
    bindEntryEvents();
    return;
  }

  if(am.status === 'pending'){
    let html = screenHeader('Grupo', { subtitle: am.group.name });
    html += switcherHtml();
    html += '<div class="placeholder">'
      +   '<div class="pico">⏳</div>'
      +   '<div class="ptitle">Pedido enviado</div>'
      +   '<div class="pdesc">Aguarde um administrador do grupo "'+esc(am.group.name)+'" aprovar sua entrada.</div>'
      + '</div>';
    html += '<button class="btn btn-ghost" id="leaveBtn" style="color:var(--danger);">Cancelar pedido</button>';
    container.innerHTML = html;
    paintSync();
    bindSwitcherEvents();
    document.getElementById('leaveBtn').onclick = leaveGroup;
    return;
  }

  if(view === 'org'){ paintOrg(am); return; }

  const group = am.group;
  const myRole = am.role;
  const canManage = myRole === 'owner' || myRole === 'admin';
  const dayLabel = DIAS_SEMANA[currentDate.getDay()] + ', ' + currentDate.getDate() + ' ' + MESES[currentDate.getMonth()];
  const isToday = isSameDay(currentDate, todayDate());

  const extra = canManage ? '<button class="icon-btn" id="orgBtn" aria-label="Organização">⚙</button>' : '';
  let html = screenHeader('Grupo', { subtitle: group.name, addBtnId: 'taskAdd', extra });
  html += switcherHtml();

  const total = tasks.length;
  const doneCount = tasks.filter(t => isDoneAt(t, currentDate)).length;
  const pct = total ? Math.round((doneCount/total)*100) : 0;

  html += '<div class="progress-row">';
  html += '<div class="stat"><div class="n">'+doneCount+'/'+total+'</div><div class="l">no dia</div></div>';
  html += '<div class="stat"><div class="n">'+pct+'%</div><div class="l">concluído</div></div>';
  html += '<div class="stat"><div class="n">'+members.length+'</div><div class="l">'+(members.length===1?'membro':'membros')+'</div></div></div>';

  html += '<div class="fin-budget" style="margin-bottom:14px;">'
    +   '<div class="fin-budget-top"><span>código de convite · '+(group.is_open?'grupo aberto':'grupo fechado')+'</span></div>'
    +   '<div class="fin-budget-amt" style="letter-spacing:.08em;">'+esc(group.invite_code)+'</div>'
    +   '<div class="fin-budget-sub">compartilhe com quem mora com você</div>'
    + '</div>';

  html += '<div class="daynav"><button id="prevBtn">‹</button>';
  html += '<div class="daylabel"><div class="d">'+dayLabel+'</div><div class="n">'+(isToday?'hoje':'')+'</div></div>';
  html += '<button id="nextBtn" '+(isToday?'disabled':'')+'>›</button></div>';
  if(!isToday) html += '<button class="today-btn" id="todayBtn">Voltar para hoje</button>';

  if(formState) html += renderTaskForm();

  if(tasks.length === 0){
    html += '<div class="empty">Nenhuma tarefa compartilhada ainda.<br>Toque no + para criar a primeira.</div>';
  } else {
    tasks.forEach(t => {
      const cnt = countAt(t, currentDate);
      const target = targetFor(t);
      const done = cnt >= target;
      const partial = cnt > 0 && !done;
      const circleTxt = target > 1 ? (cnt+'/'+target) : '✓';
      html += '<div class="item '+(done?'done':'')+(partial?' partial':'')+'" data-task="'+t.id+'">'
            + '<div class="check'+(target>1?' frac':'')+'">'+circleTxt+'</div>'
            + '<div class="item-txt"><div class="item-name">'+esc(t.name)+(t.freq_type!=='daily' ? ' <span class="freq-badge">'+freqLabel(t)+'</span>' : '')+'</div>'
            + '<div class="item-meta">'+metaFor(t)+'</div></div>'
            + '<button class="item-action" data-edit="'+t.id+'" aria-label="Editar">✎</button>'
            + '</div>';
    });
  }

  html += renderGrid();

  html += '<div class="section-title">Membros</div>';
  html += '<div class="group-members">'
    + members.filter(m => m.status === 'active').map(m => '<div class="member-row"><span class="member-dot"></span>'
        + '<span class="member-name">'+esc(m.user_id === state.user.id ? m.display_name + ' (você)' : m.display_name)+'</span>'
        + '<span class="role-badge role-'+m.role+'">'+roleLabel(m.role)+'</span></div>').join('')
    + '</div>';

  html += '<button class="btn btn-ghost" id="leaveBtn" style="margin-top:18px;color:var(--danger);">Sair do grupo</button>';

  container.innerHTML = html;
  paintSync();
  bindSwitcherEvents();
  bindGroupEvents(canManage);
}

function renderGrid(){
  let html = '<div class="section-title">Últimos '+GRID_DAYS+' dias</div>';
  const days = []; for(let i=GRID_DAYS-1;i>=0;i--) days.push(addDays(todayDate(), -i));
  if(tasks.length === 0){
    return html + '<div class="empty">A visão geral aparece assim que houver tarefas cadastradas.</div>';
  }
  const weekGroups = computeWeekGroups(days);
  html += '<div class="grid-wrap"><table><thead><tr><th class="habit-col"></th>';
  days.forEach(d => { html += '<th'+(isSameDay(d,todayDate())?' style="color:var(--text-2);font-weight:600;"':'')+'>'+d.getDate()+'</th>'; });
  html += '</tr></thead><tbody>';
  tasks.forEach(t => {
    html += '<tr><td class="habit-col">'+esc(t.name)+'</td>';
    if(t.freq_type === 'weekly'){
      weekGroups.forEach(g => {
        const on = isDoneAt(t, fromISO(g.key));
        html += '<td colspan="'+g.span+'"><div class="cell week-cell '+(on?'on':'')+'" data-task="'+t.id+'" data-weekkey="'+g.key+'"></div></td>';
      });
    } else if(t.freq_type === 'multi_daily'){
      days.forEach(d => {
        const cnt = countAt(t, d), target = targetFor(t);
        let bars = ''; for(let i=0;i<target;i++){ bars += '<span class="'+(i<cnt?'on':'')+'"></span>'; }
        html += '<td><div class="cell multi-cell '+(isSameDay(d,todayDate())?'today-col':'')+'" data-task="'+t.id+'" data-date="'+toISO(d)+'">'+bars+'</div></td>';
      });
    } else {
      days.forEach(d => {
        const on = isDoneAt(t, d);
        html += '<td><div class="cell '+(on?'on':'')+' '+(isSameDay(d,todayDate())?'today-col':'')+'" data-task="'+t.id+'" data-date="'+toISO(d)+'"></div></td>';
      });
    }
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function metaFor(task){
  const key = keyForDate(task, currentDate);
  const l = logs[task.id] && logs[task.id][key];
  const cnt = l ? l.count : 0;
  const target = targetFor(task);
  const who = l && l.done_by ? memberName(l.done_by)+(l.updated_at ? ' · '+fmtTime(l.updated_at) : '') : '';

  if(task.freq_type === 'weekly'){
    return cnt >= 1 ? 'feito esta semana por '+who : 'ainda não feito esta semana';
  }
  if(target > 1){
    return cnt >= target ? 'feito '+cnt+'x hoje · por '+who : cnt+'/'+target+' vezes hoje'+(cnt>0?' · toque para +1':'');
  }
  return cnt >= 1 ? 'feito por '+who : 'ainda não feito';
}

function renderTaskForm(){
  const editing = formState !== 'new';

  return '<div class="addform" id="taskForm">'
    + '<p class="field-label">Nome da tarefa</p>'
    + '<input class="field" id="tName" value="'+esc(formName)+'" placeholder="ex.: Dar comida pro cachorro">'
    + '<p class="field-label">Frequência</p>'
    + '<div class="form-actions" style="margin-bottom:'+(formFreq.type==='multi_daily'?'8px':'12px')+';">'
    +   '<button class="btn-sm '+(formFreq.type==='daily'?'primary':'ghost')+'" data-freq="daily">1x ao dia</button>'
    +   '<button class="btn-sm '+(formFreq.type==='multi_daily'?'primary':'ghost')+'" data-freq="multi_daily">Várias ao dia</button>'
    +   '<button class="btn-sm '+(formFreq.type==='weekly'?'primary':'ghost')+'" data-freq="weekly">1x por semana</button>'
    + '</div>'
    + (formFreq.type==='multi_daily' ? '<div class="field"><p class="field-label">Quantas vezes ao dia</p><input class="field" id="tFreqCount" type="number" min="2" max="10" value="'+formFreq.count+'"></div>' : '')
    + '<div class="form-actions">'
    +   '<button class="btn-sm ghost" id="tCancel">Cancelar</button>'
    +   (editing ? '<button class="btn-sm ghost" id="tDelete" style="color:var(--danger);">Excluir</button>' : '')
    +   '<button class="btn-sm primary" id="tSave">Salvar</button>'
    + '</div>'
    + '</div>';
}

/* ---------- organização ---------- */
function paintOrg(am){
  const group = am.group;
  const myRole = am.role;
  const isOwner = myRole === 'owner';
  const isAdmin = myRole === 'admin';

  let html = screenHeader('Organização', { subtitle: group.name });
  html += switcherHtml();
  html += '<button class="btn-sm ghost" id="orgBack" style="width:100%;margin-bottom:16px;">‹ Voltar para tarefas</button>';

  const pending = members.filter(m => m.status === 'pending');
  if(pending.length){
    html += '<div class="section-title">Pedidos de entrada</div>';
    html += '<div class="group-members">' + pending.map(m =>
      '<div class="member-row"><span class="member-dot pending"></span>'
      + '<span class="member-name">'+esc(m.display_name)+'</span>'
      + '<button class="btn-sm primary" data-approve="'+m.user_id+'" style="flex:0 0 auto;padding:6px 10px;">Aceitar</button>'
      + '<button class="btn-sm ghost" data-reject="'+m.user_id+'" style="flex:0 0 auto;padding:6px 10px;color:var(--danger);">Recusar</button>'
      + '</div>').join('') + '</div>';
  }

  html += '<div class="section-title">Membros</div>';
  const active = members.filter(m => m.status === 'active');
  html += '<div class="group-members">' + active.map(m => {
    const canRemove = m.role !== 'owner' && (isOwner || (isAdmin && m.role === 'member'));
    const canChangeRole = isOwner && m.role !== 'owner';
    const newRole = m.role === 'admin' ? 'member' : 'admin';
    return '<div class="member-row">'
      + '<span class="role-badge role-'+m.role+'">'+roleLabel(m.role)+'</span>'
      + '<span class="member-name">'+esc(m.user_id===state.user.id ? m.display_name+' (você)' : m.display_name)+'</span>'
      + (canChangeRole ? '<button class="btn-sm ghost" data-role="'+m.user_id+'" data-newrole="'+newRole+'" style="flex:0 0 auto;padding:6px 10px;">'+(m.role==='admin'?'Rebaixar':'Promover')+'</button>' : '')
      + (canRemove ? '<button class="btn-sm ghost" data-remove="'+m.user_id+'" style="flex:0 0 auto;padding:6px 10px;color:var(--danger);">Remover</button>' : '')
      + '</div>';
  }).join('') + '</div>';

  html += '<div class="section-title">Configurações</div>';
  html += '<div class="fin-budget">'
    +   '<div class="fin-budget-top"><span>tipo de grupo</span></div>'
    +   '<div class="form-actions">'
    +     '<button class="btn-sm '+(group.is_open?'primary':'ghost')+'" id="setOpen">Aberto</button>'
    +     '<button class="btn-sm '+(!group.is_open?'primary':'ghost')+'" id="setClosed">Fechado</button>'
    +   '</div>'
    +   '<div class="fin-budget-sub">'+(group.is_open ? 'Qualquer pessoa com o código entra direto.' : 'Novas entradas precisam ser aprovadas aqui.')+'</div>'
    + '</div>';

  if(isOwner){
    html += '<button class="btn btn-ghost" id="deleteGroupBtn" style="margin-top:18px;color:var(--danger);">Excluir grupo</button>';
  }

  container.innerHTML = html;
  paintSync();
  bindSwitcherEvents();
  bindOrgEvents();
}

function bindOrgEvents(){
  document.getElementById('orgBack').onclick = () => { view = 'tasks'; paint(); };
  container.querySelectorAll('[data-approve]').forEach(btn => { btn.onclick = () => respondRequest(btn.getAttribute('data-approve'), true); });
  container.querySelectorAll('[data-reject]').forEach(btn => { btn.onclick = () => respondRequest(btn.getAttribute('data-reject'), false); });
  container.querySelectorAll('[data-role]').forEach(btn => { btn.onclick = () => changeRole(btn.getAttribute('data-role'), btn.getAttribute('data-newrole')); });
  container.querySelectorAll('[data-remove]').forEach(btn => { btn.onclick = () => removeMember(btn.getAttribute('data-remove')); });
  const setOpen = document.getElementById('setOpen'); if(setOpen) setOpen.onclick = () => setGroupOpen(true);
  const setClosed = document.getElementById('setClosed'); if(setClosed) setClosed.onclick = () => setGroupOpen(false);
  const delBtn = document.getElementById('deleteGroupBtn'); if(delBtn) delBtn.onclick = deleteGroupNow;
}

/* ---------- ações: navegação entre grupos ---------- */
async function switchGroup(gid){
  if(gid === activeGroupId) return;
  activeGroupId = gid;
  view = 'tasks'; formState = null; entryMode = null; currentDate = todayDate();
  members = []; tasks = []; logs = {};
  paint();
  setSync('saving');
  try{ await loadGroupData(gid); setSync('ok'); } catch(e){ setSync('err'); }
  paint();
}

/* ---------- ações: entrada no grupo ---------- */
async function createGroup(){
  const nameEl = document.getElementById('gName');
  const name = nameEl.value.trim();
  if(!name) return;
  setSync('saving');
  const { data, error } = await supabase.rpc('create_group', { p_name: name, p_display_name: myDisplayName(), p_is_open: newGroupOpen });
  if(error){ setSync('err'); alert('Não foi possível criar o grupo: '+error.message); return; }
  myMemberships.push({ group_id: data.id, role: 'owner', status: 'active', group: data });
  activeGroupId = data.id;
  entryMode = null; newGroupOpen = true;
  await loadGroupData(activeGroupId);
  setSync('ok');
  paint();
}

async function joinGroup(){
  const codeEl = document.getElementById('gCode');
  const code = codeEl.value.trim();
  if(!code) return;
  setSync('saving');
  const { data, error } = await supabase.rpc('join_group_by_code', { p_code: code, p_display_name: myDisplayName() });
  if(error){ setSync('err'); alert('Não foi possível entrar no grupo: '+error.message); return; }
  const g = data.group, status = data.status;
  const idx = myMemberships.findIndex(m => m.group_id === g.id);
  const entry = { group_id: g.id, role: idx>=0 ? myMemberships[idx].role : 'member', status, group: g };
  if(idx>=0) myMemberships[idx] = entry; else myMemberships.push(entry);
  activeGroupId = g.id;
  entryMode = null;
  if(status === 'active') await loadGroupData(activeGroupId); else { members=[]; tasks=[]; logs={}; }
  setSync('ok');
  paint();
}

async function leaveGroup(){
  const am = activeMembership();
  if(!am) return;
  const label = am.status === 'pending' ? 'Cancelar o pedido de entrada em' : 'Sair do grupo';
  if(!confirm(label+' "'+am.group.name+'"?')) return;
  setSync('saving');
  const { error } = await supabase.rpc('leave_group', { p_group_id: activeGroupId });
  if(error){ setSync('err'); alert(error.message); return; }
  myMemberships = myMemberships.filter(m => m.group_id !== activeGroupId);
  activeGroupId = (myMemberships[0] || {}).group_id || null;
  members=[]; tasks=[]; logs={}; view='tasks'; formState=null; currentDate=todayDate();
  if(activeGroupId) await loadGroupData(activeGroupId);
  setSync('ok');
  paint();
}

/* ---------- ações: organização ---------- */
async function respondRequest(userId, approve){
  setSync('saving');
  const { error } = await supabase.rpc('respond_join_request', { p_group_id: activeGroupId, p_user_id: userId, p_approve: approve });
  if(error){ setSync('err'); alert(error.message); return; }
  await loadGroupData(activeGroupId);
  setSync('ok');
  paint();
}

async function changeRole(userId, newRole){
  setSync('saving');
  const { error } = await supabase.rpc('set_member_role', { p_group_id: activeGroupId, p_user_id: userId, p_role: newRole });
  if(error){ setSync('err'); alert(error.message); return; }
  await loadGroupData(activeGroupId);
  setSync('ok');
  paint();
}

async function removeMember(userId){
  if(!confirm('Remover este membro do grupo?')) return;
  setSync('saving');
  const { error } = await supabase.from('group_members').delete().eq('group_id', activeGroupId).eq('user_id', userId);
  if(error){ setSync('err'); alert('Não foi possível remover: '+error.message); return; }
  await loadGroupData(activeGroupId);
  setSync('ok');
  paint();
}

async function setGroupOpen(isOpen){
  setSync('saving');
  const { error } = await supabase.from('groups').update({ is_open: isOpen }).eq('id', activeGroupId);
  if(error){ setSync('err'); return; }
  const am = activeMembership(); if(am) am.group.is_open = isOpen;
  setSync('ok');
  paint();
}

async function deleteGroupNow(){
  const am = activeMembership();
  if(!am) return;
  if(!confirm('Excluir permanentemente o grupo "'+am.group.name+'"? Essa ação não pode ser desfeita.')) return;
  setSync('saving');
  const { error } = await supabase.from('groups').delete().eq('id', activeGroupId);
  if(error){ setSync('err'); alert('Não foi possível excluir: '+error.message); return; }
  myMemberships = myMemberships.filter(m => m.group_id !== activeGroupId);
  activeGroupId = (myMemberships[0] || {}).group_id || null;
  members=[]; tasks=[]; logs={}; view='tasks'; formState=null;
  if(activeGroupId) await loadGroupData(activeGroupId);
  setSync('ok');
  paint();
}

/* ---------- ações: tarefas ---------- */
async function bump(task, date){
  const key = keyForDate(task, date);
  const target = targetFor(task);
  const cur = countAt(task, date);
  const next = cur >= target ? 0 : cur + 1;
  if(!logs[task.id]) logs[task.id] = {};
  logs[task.id][key] = { task_id: task.id, log_date: key, count: next, done_by: next>0 ? state.user.id : null, updated_at: new Date().toISOString() };
  paint();
  setSync('saving');
  const { error } = await supabase.from('group_task_log').upsert({
    group_id: activeGroupId, task_id: task.id, log_date: key,
    count: next, done: next >= target, done_by: next>0 ? state.user.id : null, updated_at: new Date().toISOString(),
  }, { onConflict: 'task_id,log_date' });
  setSync(error ? 'err' : 'ok');
}

function openTaskForm(id){
  formState = id;
  if(id === 'new'){ formName = ''; formFreq = { type: 'daily', count: 2 }; }
  else { const t = tasks.find(x => x.id === id); formName = t.name; formFreq = { type: t.freq_type, count: t.freq_count }; }
  paint();
}

async function saveTask(){
  const name = formName.trim();
  if(!name) return;
  const freq_type = formFreq.type;
  const freq_count = freq_type === 'multi_daily' ? Math.max(2, parseInt(document.getElementById('tFreqCount').value, 10) || 2) : 1;
  setSync('saving');
  if(formState === 'new'){
    const { data, error } = await supabase.from('group_tasks')
      .insert({ group_id: activeGroupId, name, freq_type, freq_count })
      .select('id,name,archived,freq_type,freq_count').single();
    if(error){ setSync('err'); return; }
    tasks.push(data);
  } else {
    const { error } = await supabase.from('group_tasks').update({ name, freq_type, freq_count }).eq('id', formState);
    if(error){ setSync('err'); return; }
    const t = tasks.find(x => x.id === formState);
    t.name = name; t.freq_type = freq_type; t.freq_count = freq_count;
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

function bindGroupEvents(canManage){
  document.getElementById('prevBtn').onclick = () => { currentDate = addDays(currentDate,-1); paint(); };
  const nextBtn = document.getElementById('nextBtn');
  if(!nextBtn.disabled) nextBtn.onclick = () => { currentDate = addDays(currentDate,1); paint(); };
  const tb = document.getElementById('todayBtn'); if(tb) tb.onclick = () => { currentDate = todayDate(); paint(); };

  document.getElementById('taskAdd').onclick = () => {
    if(formState){ formState = null; paint(); } else { openTaskForm('new'); }
  };
  if(canManage){ const orgBtn = document.getElementById('orgBtn'); if(orgBtn) orgBtn.onclick = () => { view = 'org'; paint(); }; }

  const form = document.getElementById('taskForm');
  if(form){
    document.getElementById('tName').oninput = (e) => { formName = e.target.value; };
    document.getElementById('tCancel').onclick = () => { formState = null; paint(); };
    document.getElementById('tSave').onclick = saveTask;
    const delBtn = document.getElementById('tDelete'); if(delBtn) delBtn.onclick = deleteTask;
    const countEl = document.getElementById('tFreqCount');
    if(countEl) countEl.oninput = (e) => { formFreq.count = parseInt(e.target.value, 10) || formFreq.count; };
    container.querySelectorAll('[data-freq]').forEach(btn => {
      btn.onclick = () => { formFreq.type = btn.getAttribute('data-freq'); if(formFreq.type === 'multi_daily' && formFreq.count < 2) formFreq.count = 2; paint(); };
    });
  }

  container.querySelectorAll('.item[data-task]').forEach(elc => {
    elc.onclick = (e) => {
      if(e.target.closest('[data-edit]')) return;
      const t = tasks.find(x => x.id === elc.getAttribute('data-task'));
      if(t) bump(t, currentDate);
    };
  });
  container.querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); openTaskForm(btn.getAttribute('data-edit')); };
  });
  container.querySelectorAll('.cell[data-task]').forEach(elc => {
    elc.onclick = (e) => {
      e.stopPropagation();
      const t = tasks.find(x => x.id === elc.getAttribute('data-task'));
      if(!t) return;
      const dateAttr = elc.getAttribute('data-date') || elc.getAttribute('data-weekkey');
      bump(t, fromISO(dateAttr));
    };
  });

  document.getElementById('leaveBtn').onclick = leaveGroup;
}

export function resetGroupState(){
  myMemberships = []; activeGroupId = null; members = []; tasks = []; logs = {};
  currentDate = todayDate(); loaded = false; entryMode = null; newGroupOpen = true;
  formState = null; formName = ''; formFreq = { type:'daily', count:2 }; view = 'tasks';
}
