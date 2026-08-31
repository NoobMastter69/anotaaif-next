-- ══════════════════════════════════════════════════════════════
-- Dono (owner) + Presença (quem entra e sai do app)
-- Somente o DONO enxerga access_sessions. Admin e moderador NÃO.
-- ══════════════════════════════════════════════════════════════

-- ── 1. Flag de dono no perfil ─────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE;

-- Trava: ninguém logado pode se promover a dono (só o service role, via SQL/API).
CREATE OR REPLACE FUNCTION guard_is_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- auth.uid() é NULL quando a operação vem do service role (SQL editor / API server).
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.is_owner := FALSE;
    ELSIF NEW.is_owner IS DISTINCT FROM OLD.is_owner THEN
      RAISE EXCEPTION 'is_owner só pode ser alterado pelo service role';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profiles_guard_is_owner ON profiles;
CREATE TRIGGER profiles_guard_is_owner
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_is_owner();

-- Helper usado nas policies (SECURITY DEFINER evita recursão de RLS).
CREATE OR REPLACE FUNCTION is_owner_user()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE((SELECT is_owner FROM profiles WHERE id = auth.uid()), FALSE);
$$;

-- ── 2. Sessões de acesso (entrou / continua / saiu) ───────────
CREATE TABLE IF NOT EXISTS access_sessions (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name    TEXT,
  class_code   TEXT,
  role         TEXT,               -- 'dono' | 'admin' | 'moderador' | 'aluno' | 'visitante'
  ip           TEXT,
  city         TEXT,
  region       TEXT,
  country      TEXT,
  user_agent   TEXT,
  device       TEXT,               -- 'iPhone', 'Android', 'Windows', …
  os           TEXT,
  browser      TEXT,
  is_pwa       BOOLEAN DEFAULT FALSE,
  screen       TEXT,               -- '390x844'
  timezone     TEXT,
  language     TEXT,
  entry_path   TEXT,
  referrer     TEXT,
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at     TIMESTAMPTZ,
  end_reason   TEXT,               -- 'fechou' | 'logout' | 'timeout'
  pings        INT DEFAULT 1
);

CREATE INDEX IF NOT EXISTS access_sessions_last_seen_idx ON access_sessions (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS access_sessions_started_idx   ON access_sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS access_sessions_user_idx      ON access_sessions (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS access_sessions_open_idx      ON access_sessions (ended_at) WHERE ended_at IS NULL;

ALTER TABLE access_sessions ENABLE ROW LEVEL SECURITY;

-- ÚNICA policy: só o dono lê. Sem policy de INSERT/UPDATE/DELETE →
-- apenas o service role (rota /api/presence) escreve. Admin/mod não veem nada.
DROP POLICY IF EXISTS "access_sessions_select_owner" ON access_sessions;
CREATE POLICY "access_sessions_select_owner" ON access_sessions
  FOR SELECT TO authenticated
  USING (is_owner_user());

-- ── 3. Limpeza automática ─────────────────────────────────────
-- Fecha sessões abandonadas (sem ping há 3 min) e apaga histórico > 90 dias.
CREATE OR REPLACE FUNCTION cleanup_access_sessions()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE access_sessions
     SET ended_at = last_seen_at, end_reason = 'timeout'
   WHERE ended_at IS NULL
     AND last_seen_at < NOW() - INTERVAL '3 minutes';

  DELETE FROM access_sessions WHERE started_at < NOW() - INTERVAL '90 days';
END $$;

-- ══════════════════════════════════════════════════════════════
-- 4. DEFINE O DONO
--    ID conferido direto no banco: Ed Carlos, o único admin.
--    (o login do app é ed.carlos@anotaaif.app — o app gera um e-mail
--    interno a partir do nome, por isso não é o e-mail pessoal)
-- ══════════════════════════════════════════════════════════════
UPDATE profiles SET is_owner = TRUE
 WHERE id = '7cd1acf7-964d-42e4-99b5-11171ad2f8d2';

-- Confere quem ficou como dono:
--   SELECT p.id, p.full_name, u.email FROM profiles p
--   JOIN auth.users u ON u.id = p.id WHERE p.is_owner;

-- Para dar acesso ao painel de Presença pra mais alguém (seu irmão, por ex.),
-- basta rodar depois, trocando o ID:
--   UPDATE profiles SET is_owner = TRUE WHERE id = 'ID-DA-PESSOA';
