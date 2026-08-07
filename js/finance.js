import { supabase } from './supabaseClient.js';
import { state, setSync, paintSync } from './state.js';
import { screenHeader, esc, brl } from './ui.js';

/* ============================================================
   Financeiro — versão 1b: barra de orçamento do mês + duas
   seções separadas (Contas fixas / Ganhos). Cada lançamento é
   uma linha em finance_entries (type: 'bill' | 'income').
   ============================================================ */

const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

let entries = [];       // [{id,type,name,amount,date,paid,created_at}]
let currentMonth = startOfMonth(new Date());
let container = null;
let loaded = false;
let formState = null;   // null | 'new' | <entryId em edição>
let newEntryType = 'bill';

/* ---------- datas ---------- */
function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d, n){ return new Date(d.getFullYear(), d.getMonth()+n, 1); }
function monthKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
function isSameMonth(a,b){ return monthKey(a) === monthKey(b); }
function toISODate(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0'); return y+'-'+m+'-'+dd; }
function fromISODate(s){ const [y,m,dd] = s.split('-').map(Number); return new Date(y, m-1, dd); }
function fmtDate(iso){ const [,m,dd] = iso.split('-').map(Number); return String(dd).padStart(2,'0')+' '+MESES[m-1].slice(0,3); }

/* ---------- carga ---------- */
export async function render(el){
  container = el;
  paint();
  if(!loaded){
    await loadAll();
    loaded = true;
    if(state.currentTab === 'finance') paint();
  }
}

async function loadAll(){
  setSync('saving');
  const { data, error } = await supabase
    .from('finance_entries')
    .select('id,type,name,amount,date,paid,created_at')
    .order('date', { ascending: true });
  if(error){ setSync('err'); return; }
  entries = data || [];
  setSync('ok');
}

function entriesOfMonth(type){
  return entries.filter(e => e.type === type && isSameMonth(fromISODate(e.date), currentMonth));
}

/* ---------- render ---------- */
function paint(){
  const isCurrentMonth = isSameMonth(currentMonth, startOfMonth(new Date()));
  const monthLabel = MESES[currentMonth.getMonth()] + ' ' + currentMonth.getFullYear();

  const bills = entriesOfMonth('bill');
  const incomes = entriesOfMonth('income');
  const billsTotal = bills.reduce((s,e) => s + Number(e.amount), 0);
  const incomeTotal = incomes.reduce((s,e) => s + Number(e.amount), 0);
  const saldo = incomeTotal - billsTotal;
  const pct = incomeTotal ? Math.round((billsTotal/incomeTotal)*100) : (billsTotal > 0 ? 100 : 0);
  const barPct = Math.min(100, pct);
  const pendingCount = bills.filter(e => !e.paid).length;

  let html = screenHeader('Financeiro', { addBtnId: 'finAdd' });

  html += '<div class="fin-budget">'
    +   '<div class="fin-budget-top"><span>orçamento de '+MESES[currentMonth.getMonth()]+'</span>'
    +     '<span class="fin-budget-amt '+(saldo<0?'money-neg':'money-pos')+'">'+brl(saldo)+'</span></div>'
    +   '<div class="fin-bar"><div class="fin-bar-fill'+(pct>=100?' over':'')+'" style="width:'+barPct+'%"></div></div>'
    +   '<div class="fin-budget-sub">'+brl(billsTotal)+' em contas de '+brl(incomeTotal)+' recebidos ('+pct+'%)</div>'
    + '</div>';

  html += '<div class="daynav"><button id="prevMonthBtn">‹</button>'
    +   '<div class="daylabel"><div class="d">'+monthLabel+'</div><div class="n">'+(isCurrentMonth?'mês atual':'')+'</div></div>'
    +   '<button id="nextMonthBtn">›</button></div>';
  if(!isCurrentMonth) html += '<button class="today-btn" id="curMonthBtn">Voltar para o mês atual</button>';

  if(formState) html += renderForm();

  html += '<div class="fin-section-row"><span class="lbl">Contas fixas</span>'
    + '<span class="cnt">'+brl(billsTotal)+' · '+pendingCount+' pendente'+(pendingCount!==1?'s':'')+'</span></div>';
  if(bills.length === 0){
    html += '<div class="empty">Nenhuma conta cadastrada em '+MESES[currentMonth.getMonth()]+'.</div>';
  } else {
    bills.forEach(e => {
      html += '<div class="item '+(e.paid?'done':'')+'" data-bill="'+e.id+'">'
            +   '<div class="check">✓</div>'
            +   '<div class="item-txt"><div class="item-name">'+esc(e.name)+'</div>'
            +   '<div class="item-meta">vence '+fmtDate(e.date)+' · '+brl(e.amount)+'</div></div>'
            +   '<span class="status-pill '+(e.paid?'paid':'pending')+'">'+(e.paid?'pago':'pendente')+'</span>'
            +   '<button class="item-action" data-edit-bill="'+e.id+'" aria-label="Editar">✎</button>'
            + '</div>';
    });
  }

  html += '<div class="fin-section-row"><span class="lbl">Ganhos</span>'
    + '<span class="cnt">'+brl(incomeTotal)+' · '+incomes.length+' lançamento'+(incomes.length!==1?'s':'')+'</span></div>';
  if(incomes.length === 0){
    html += '<div class="empty">Nenhum ganho registrado em '+MESES[currentMonth.getMonth()]+'.</div>';
  } else {
    incomes.forEach(e => {
      html += '<div class="item" data-income="'+e.id+'">'
            +   '<div class="item-plus">+</div>'
            +   '<div class="item-txt"><div class="item-name">'+esc(e.name)+'</div>'
            +   '<div class="item-meta">'+fmtDate(e.date)+'</div></div>'
            +   '<span class="item-amt money-pos">'+brl(e.amount)+'</span>'
            +   '<button class="item-action" data-del-income="'+e.id+'" aria-label="Remover">🗑</button>'
            + '</div>';
    });
  }

  container.innerHTML = html;
  paintSync();
  bindEvents();
}

function renderForm(){
  const editing = formState !== 'new';
  const e = editing ? entries.find(x => x.id === formState) : null;
  const type = editing ? e.type : newEntryType;
  const name = e ? e.name : '';
  const amount = e ? e.amount : '';
  const date = e ? e.date : toISODate(isSameMonth(currentMonth, startOfMonth(new Date())) ? new Date() : currentMonth);

  return '<div class="addform" id="finForm">'
    + (editing ? '' : '<div class="form-actions" style="margin-bottom:10px;">'
        +   '<button class="btn-sm '+(type==='bill'?'primary':'ghost')+'" id="typeBill">Conta fixa</button>'
        +   '<button class="btn-sm '+(type==='income'?'primary':'ghost')+'" id="typeIncome">Ganho</button>'
        + '</div>')
    + '<p class="field-label">Nome</p>'
    + '<input class="field" id="fName" value="'+esc(name)+'" placeholder="'+(type==='bill'?'ex.: Aluguel':'ex.: Salário')+'">'
    + '<div class="row2">'
    +   '<div class="field"><p class="field-label">Valor (R$)</p><input class="field" id="fAmount" type="number" step="0.01" min="0" value="'+esc(amount)+'"></div>'
    +   '<div class="field"><p class="field-label">'+(type==='bill'?'Vencimento':'Data')+'</p><input class="field" id="fDate" type="date" value="'+date+'"></div>'
    + '</div>'
    + '<div class="form-actions">'
    +   '<button class="btn-sm ghost" id="fCancel">Cancelar</button>'
    +   (editing ? '<button class="btn-sm ghost" id="fDelete" style="color:var(--danger);">Excluir</button>' : '')
    +   '<button class="btn-sm primary" id="fSave">Salvar</button>'
    + '</div>'
    + '</div>';
}

/* ---------- ações ---------- */
async function saveEntry(){
  const name = document.getElementById('fName').value.trim();
  const amount = parseFloat(document.getElementById('fAmount').value);
  const date = document.getElementById('fDate').value;
  if(!name || !date || isNaN(amount) || amount <= 0) return;
  setSync('saving');
  if(formState === 'new'){
    const { data, error } = await supabase.from('finance_entries')
      .insert({ user_id: state.user.id, type: newEntryType, name, amount, date, paid: false })
      .select('id,type,name,amount,date,paid,created_at').single();
    if(error){ setSync('err'); return; }
    entries.push(data);
  } else {
    const { error } = await supabase.from('finance_entries').update({ name, amount, date }).eq('id', formState);
    if(error){ setSync('err'); return; }
    const e = entries.find(x => x.id === formState);
    e.name = name; e.amount = amount; e.date = date;
  }
  setSync('ok');
  formState = null;
  paint();
}

async function deleteEntry(){
  if(!confirm('Excluir este lançamento?')) return;
  setSync('saving');
  const { error } = await supabase.from('finance_entries').delete().eq('id', formState);
  if(!error){ entries = entries.filter(x => x.id !== formState); }
  setSync(error ? 'err' : 'ok');
  formState = null;
  paint();
}

async function togglePaid(id){
  const e = entries.find(x => x.id === id);
  if(!e) return;
  e.paid = !e.paid;
  paint();
  setSync('saving');
  const { error } = await supabase.from('finance_entries').update({ paid: e.paid }).eq('id', id);
  setSync(error ? 'err' : 'ok');
}

async function deleteIncome(id){
  entries = entries.filter(x => x.id !== id);
  paint();
  setSync('saving');
  const { error } = await supabase.from('finance_entries').delete().eq('id', id);
  setSync(error ? 'err' : 'ok');
}

function bindEvents(){
  document.getElementById('prevMonthBtn').onclick = () => { currentMonth = addMonths(currentMonth,-1); paint(); };
  document.getElementById('nextMonthBtn').onclick = () => { currentMonth = addMonths(currentMonth,1); paint(); };
  const cmb = document.getElementById('curMonthBtn'); if(cmb) cmb.onclick = () => { currentMonth = startOfMonth(new Date()); paint(); };

  document.getElementById('finAdd').onclick = () => {
    formState = formState ? null : 'new';
    if(formState === 'new') newEntryType = 'bill';
    paint();
  };

  const form = document.getElementById('finForm');
  if(form){
    document.getElementById('fCancel').onclick = () => { formState = null; paint(); };
    document.getElementById('fSave').onclick = saveEntry;
    const delBtn = document.getElementById('fDelete'); if(delBtn) delBtn.onclick = deleteEntry;
    const tb = document.getElementById('typeBill'); if(tb) tb.onclick = () => { newEntryType = 'bill'; paint(); };
    const ti = document.getElementById('typeIncome'); if(ti) ti.onclick = () => { newEntryType = 'income'; paint(); };
  }

  container.querySelectorAll('.item[data-bill]').forEach(elc => {
    elc.onclick = (e) => { if(e.target.closest('[data-edit-bill]')) return; togglePaid(elc.getAttribute('data-bill')); };
  });
  container.querySelectorAll('[data-edit-bill]').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); formState = btn.getAttribute('data-edit-bill'); paint(); };
  });
  container.querySelectorAll('[data-del-income]').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); deleteIncome(btn.getAttribute('data-del-income')); };
  });
}

export function resetFinanceState(){ entries = []; currentMonth = startOfMonth(new Date()); loaded = false; formState = null; newEntryType = 'bill'; }