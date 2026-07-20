import { supabase } from './supabaseClient.js';
import { state, setSync, paintSync } from './state.js';
import { screenHeader, esc } from './ui.js';

let goals = [];
let container = null;
let loaded = false;
let showForm = false;

export async function render(el){
  container = el;
  paint();
  if(!loaded){
    await loadGoals();
    loaded = true;
    if(state.currentTab === 'goals') paint();
  }
}

async function loadGoals(){
  setSync('saving');
  const { data, error } = await supabase
    .from('goals')
    .select('id,text,done,created_at')
    .order('done', { ascending: true })
    .order('created_at', { ascending: true });
  if(error){ setSync('err'); return; }
  goals = data || [];
  setSync('ok');
}

function paint(){
  let html = screenHeader('Metas', { addBtnId: 'goalAdd' });

  html += '<div class="addform '+(showForm?'':'hidden')+'" id="goalForm">'
        +   '<input class="field" id="goalText" placeholder="Nova meta (ex.: terminar curso de SQL)">'
        +   '<div class="form-actions">'
        +     '<button class="btn-sm ghost" id="goalCancel">Cancelar</button>'
        +     '<button class="btn-sm primary" id="goalSave">Adicionar</button>'
        +   '</div>'
        + '</div>';

  if(goals.length === 0){
    html += '<div class="empty">Nenhuma meta ainda.<br>Toque no + para adicionar a primeira.</div>';
  } else {
    goals.forEach(g => {
      html += '<div class="item '+(g.done?'done':'')+'" data-id="'+g.id+'">'
            +   '<div class="check">✓</div>'
            +   '<div class="item-txt"><div class="item-name strike">'+esc(g.text)+'</div></div>'
            +   '<button class="item-action" data-del="'+g.id+'" aria-label="Remover">🗑</button>'
            + '</div>';
    });
  }

  container.innerHTML = html;
  paintSync();

  document.getElementById('goalAdd').onclick = () => { showForm = !showForm; paint(); if(showForm) document.getElementById('goalText').focus(); };
  const form = document.getElementById('goalForm');
  if(form){
    document.getElementById('goalCancel').onclick = () => { showForm = false; paint(); };
    document.getElementById('goalSave').onclick = saveGoal;
    document.getElementById('goalText').onkeydown = (e) => { if(e.key === 'Enter') saveGoal(); };
  }

  container.querySelectorAll('.item[data-id]').forEach(elc => {
    elc.onclick = (e) => {
      if(e.target.closest('[data-del]')) return;   // clique na lixeira não alterna
      toggleGoal(elc.getAttribute('data-id'));
    };
  });
  container.querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); deleteGoal(btn.getAttribute('data-del')); };
  });
}

async function saveGoal(){
  const input = document.getElementById('goalText');
  const text = input.value.trim();
  if(!text) return;
  showForm = false;
  setSync('saving');
  const { data, error } = await supabase
    .from('goals')
    .insert({ user_id: state.user.id, text })
    .select('id,text,done,created_at')
    .single();
  if(error){ setSync('err'); return; }
  goals.push(data);
  setSync('ok');
  paint();
}

async function toggleGoal(id){
  const g = goals.find(x => x.id === id);
  if(!g) return;
  g.done = !g.done;
  paint();
  setSync('saving');
  const { error } = await supabase
    .from('goals')
    .update({ done: g.done, done_at: g.done ? new Date().toISOString() : null })
    .eq('id', id);
  setSync(error ? 'err' : 'ok');
}

async function deleteGoal(id){
  goals = goals.filter(x => x.id !== id);
  paint();
  setSync('saving');
  const { error } = await supabase.from('goals').delete().eq('id', id);
  setSync(error ? 'err' : 'ok');
}

export function resetGoalsState(){ goals = []; loaded = false; showForm = false; }
