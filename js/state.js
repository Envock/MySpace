/* Estado global do app, compartilhado entre os módulos.
   Ponto único de verdade para usuário logado, aba ativa e status de sync. */
export const state = {
  user: null,
  currentTab: 'habits',   // 'habits' | 'goals' | 'group' | 'finance'
  syncState: 'ok',        // 'ok' | 'saving' | 'err'
};

export function setUser(u){ state.user = u; }
export function setTab(t){ state.currentTab = t; }

/* Atualiza o status de sincronização e repinta o selo, se estiver na tela. */
export function setSync(s){ state.syncState = s; paintSync(); }

export function paintSync(){
  const el = document.getElementById('syncPill');
  if(!el) return;
  if(state.syncState === 'saving'){ el.className = 'sync saving'; el.textContent = 'salvando…'; }
  else if(state.syncState === 'err'){ el.className = 'sync err'; el.textContent = 'offline — salvo local'; }
  else { el.className = 'sync'; el.textContent = 'sincronizado ✓'; }
}
