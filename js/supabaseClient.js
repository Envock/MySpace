import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* ============================================================
   Configuração do projeto Supabase.
   Use SEMPRE a publishable key aqui (nunca a secret/service_role).
   ============================================================ */
export const SUPABASE_URL = 'https://nualjwvixoeimbaqlmgj.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_mQiUImIzAgQvfs81YiMMhw_wu-K2mh-';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
