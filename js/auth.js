import { supabase } from './supabaseClient.js';

/* ---------- chamadas de autenticação ---------- */
export function signInEmail(email, password){ return supabase.auth.signInWithPassword({ email, password }); }
export function signUpEmail(email, password){ return supabase.auth.signUp({ email, password }); }
export function signInGoogle(){ return supabase.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: window.location.href } }); }
export function signOut(){ return supabase.auth.signOut(); }

/* ---------- tela de login ---------- */
export function renderLogin(app, message){
  app.innerHTML =
    '<div class="login">'
    + '<h1>MySpace</h1>'
    + '<p class="sub">Entre para acessar seu espaço.</p>'
    + (message ? '<div class="msg '+message.type+'">'+message.text+'</div>' : '')
    + '<input class="field" id="email" type="email" placeholder="seu@email.com" autocomplete="email">'
    + '<input class="field" id="pass" type="password" placeholder="senha" autocomplete="current-password">'
    + '<button class="btn btn-primary" id="btnLogin">Entrar</button>'
    + '<button class="btn btn-ghost" id="btnSignup">Criar conta</button>'
    + '<div class="divider">ou</div>'
    + '<button class="btn btn-google" id="btnGoogle">'
    + '<svg class="gicon" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.8 6C12.2 13.2 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16z"/><path fill="#FBBC05" d="M10.3 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.5l-7.1-5.5c-2 1.4-4.6 2.2-8.2 2.2-6.4 0-11.8-3.7-13.7-9.2l-7.8 6C6.4 42.6 14.6 48 24 48z"/></svg>'
    + 'Continuar com Google</button>'
    + '</div>';

  const emailEl = document.getElementById('email');
  const passEl = document.getElementById('pass');

  document.getElementById('btnLogin').onclick = async () => {
    const { error } = await signInEmail(emailEl.value.trim(), passEl.value);
    if(error) renderLogin(app, {type:'err', text: traduzErro(error.message)});
  };
  document.getElementById('btnSignup').onclick = async () => {
    const { data:d, error } = await signUpEmail(emailEl.value.trim(), passEl.value);
    if(error){ renderLogin(app, {type:'err', text: traduzErro(error.message)}); return; }
    if(d.user && !d.session) renderLogin(app, {type:'ok', text:'Conta criada! Confirme pelo e-mail ou desative a confirmação no Supabase.'});
  };
  document.getElementById('btnGoogle').onclick = async () => {
    const { error } = await signInGoogle();
    if(error) renderLogin(app, {type:'err', text: traduzErro(error.message)});
  };
}

export function traduzErro(m){
  if(/Invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
  if(/already registered/i.test(m)) return 'Este e-mail já tem conta. Tente entrar.';
  if(/Email not confirmed/i.test(m)) return 'E-mail ainda não confirmado.';
  if(/provider is not enabled/i.test(m)) return 'Login com Google ainda não configurado no Supabase.';
  if(/at least 6/i.test(m)) return 'A senha precisa ter ao menos 6 caracteres.';
  return m;
}
