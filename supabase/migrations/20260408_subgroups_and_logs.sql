-- ── Audit logs ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name  TEXT,
  action     TEXT NOT NULL,   -- ex: 'task_created', 'name_changed', 'user_banned'
  details    JSONB,           -- dados extras (subject, old_name, new_name, etc.)
  class_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Só admins leem
CREATE POLICY "audit_select_admin" ON audit_logs
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Qualquer autenticado pode inserir (via service role as funções fazem isso)
CREATE POLICY "audit_insert_any" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- ── Subgrupos ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subgroups (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  class_code  TEXT NOT NULL REFERENCES rooms(class_code) ON DELETE CASCADE,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_code TEXT UNIQUE DEFAULT upper(substring(md5(gen_random_uuid()::text), 1, 8)),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subgroup_members (
  subgroup_id UUID REFERENCES subgroups(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (subgroup_id, user_id)
);

ALTER TABLE subgroups ENABLE ROW LEVEL SECURITY;
ALTER TABLE subgroup_members ENABLE ROW LEVEL SECURITY;

-- Helpers
CREATE OR REPLACE FUNCTION is_subgroup_member(sg_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM subgroup_members WHERE subgroup_id = sg_id AND user_id = auth.uid()
  );
$$;

-- Subgroups: membros veem o próprio subgrupo; admin vê tudo
CREATE POLICY "subgroups_select_member" ON subgroups
  FOR SELECT TO authenticated
  USING (is_subgroup_member(id) OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Qualquer aluno com turma pode criar subgrupo
CREATE POLICY "subgroups_insert_auth" ON subgroups
  FOR INSERT TO authenticated
  WITH CHECK (
    class_code = get_my_class_code_safe()
    AND auth.uid() = created_by
  );

-- Só dono pode atualizar/deletar
CREATE POLICY "subgroups_update_owner" ON subgroups
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "subgroups_delete_owner" ON subgroups
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Subgroup members: membros veem outros membros do mesmo subgrupo; admin vê tudo
CREATE POLICY "sgm_select" ON subgroup_members
  FOR SELECT TO authenticated
  USING (is_subgroup_member(subgroup_id) OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "sgm_insert_self" ON subgroup_members
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "sgm_delete_self" ON subgroup_members
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR EXISTS (
    SELECT 1 FROM subgroups WHERE id = subgroup_id AND created_by = auth.uid()
  ));

-- ── Adiciona subgroup_id em tasks ────────────────────────
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS subgroup_id UUID REFERENCES subgroups(id) ON DELETE CASCADE;

-- Tasks de subgrupo: membros do subgrupo podem ler e inserir diretamente
CREATE POLICY "tasks_subgroup_select" ON tasks
  FOR SELECT TO authenticated
  USING (subgroup_id IS NOT NULL AND is_subgroup_member(subgroup_id));

CREATE POLICY "tasks_subgroup_insert" ON tasks
  FOR INSERT TO authenticated
  WITH CHECK (subgroup_id IS NOT NULL AND is_subgroup_member(subgroup_id));

CREATE POLICY "tasks_subgroup_delete" ON tasks
  FOR DELETE TO authenticated
  USING (subgroup_id IS NOT NULL AND (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM subgroups WHERE id = subgroup_id AND created_by = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  ));
