/* Helpers de UI reutilizados por várias telas. */

/* Cabeçalho padrão de uma tela: título, subtítulo opcional,
   botão "+" opcional (à direita) e o selo de sincronização. */
export function screenHeader(title, { subtitle = '', addBtnId = '' } = {}){
  return ''
    + '<div class="topbar">'
    +   '<div><h1>' + esc(title) + '</h1>'
    +   (subtitle ? '<p class="sub">' + esc(subtitle) + '</p>' : '')
    +   '</div>'
    +   '<div class="head-right">'
    +     (addBtnId ? '<button class="icon-btn" id="' + addBtnId + '" aria-label="Adicionar">+</button>' : '')
    +     '<div class="sync" id="syncPill">…</div>'
    +   '</div>'
    + '</div>';
}

/* Escapa texto vindo do usuário antes de injetar via innerHTML. */
export function esc(s){
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* Formata número como moeda BRL. */
export function brl(n){
  return (Number(n) || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}
