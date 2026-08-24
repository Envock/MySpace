import { supabase } from './supabaseClient.js';
import { state, setUser, setTab } from './state.js';
import { renderLogin, signOut } from './auth.js';
import { esc } from './ui.js';
import * as habits from './habits.js';
import * as goals from './goals.js';
import * as group from './group.js';
import * as finance from './finance.js';

const app = document.getElementById('app');
let lastUserId = null;

/* ---------- ícones das abas ---------- */
const ICONS = {
  habits: '<path d="M12 3c1 3-1 4-1 6a3 3 0 0 0 6 0c0-1 0-2-1-3 3 2 4 5 4 8a8 8 0 0 1-16 0c0-4 3-7 8-11z"/>',
  goals:  '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
  group:  '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M16 6a3 3 0 0 1 0 6"/><path d="M21 20c0-2-1.5-3.5-3.5-4.3"/>',
  finance:'<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="17" cy="14" r="1.3"/>',
};
const TABS = [
  { id:'habits',  label:'Hábitos' },
  { id:'goals',   label:'Metas' },
  { id:'group',   label:'Grupo' },
  { id:'finance', label:'Financeiro' },
];

/* ---------- entrada ---------- */
async function showFor(session){
  const u = session ? session.user : null;
  setUser(u);

  if(u && u.id !== lastUserId){ resetFeatureStates(); }
  lastUserId = u ? u.id : null;

  if(!u){ renderLogin(app); return; }
  renderShell();
  renderActiveTab();
}

function resetFeatureStates(){
  habits.resetHabitsState();
  goals.resetGoalsState();
  group.resetGroupState();
  finance.resetFinanceState();
}

/* ---------- estrutura persistente (tela + footer + abas) ---------- */
function renderShell(){
  let tabbar = '<nav class="tabbar">';
  TABS.forEach(t => {
    tabbar += '<button class="tab'+(state.currentTab===t.id?' active':'')+'" id="tab-'+t.id+'">'
            +   '<svg class="tico" viewBox="0 0 24 24">'+ICONS[t.id]+'</svg>'
            +   '<span class="tlabel">'+t.label+'</span>'
            + '</button>';
  });
  tabbar += '</nav>';

  const footer = '<div class="accountbar">'
    + '<span>'+esc(state.user.email || 'conta Google')+'</span>'
    + '<button class="linkbtn" id="logoutBtn">sair</button>'
    + '</div>';

  app.innerHTML = '<div class="wrap"><div id="screen"></div>'+footer+'</div>'+tabbar;

  TABS.forEach(t => {
    document.getElementById('tab-'+t.id).onclick = () => switchTab(t.id);
  });
  document.getElementById('logoutBtn').onclick = async () => { await signOut(); };
}

function switchTab(tab){
  if(state.currentTab === tab) return;
  setTab(tab);
  TABS.forEach(t => {
    document.getElementById('tab-'+t.id).classList.toggle('active', t.id === tab);
  });
  renderActiveTab();
}

function renderActiveTab(){
  const screen = document.getElementById('screen');
  if(state.currentTab === 'habits'){ habits.render(screen); }
  else if(state.currentTab === 'goals'){ goals.render(screen); }
  else if(state.currentTab === 'group'){ group.render(screen); }
  else if(state.currentTab === 'finance'){ finance.render(screen); }
}

/* ---------- ciclo de auth ---------- */
supabase.auth.onAuthStateChange((_event, session) => { showFor(session); });
(async function init(){
  const { data:{ session } } = await supabase.auth.getSession();
  showFor(session);
})();
