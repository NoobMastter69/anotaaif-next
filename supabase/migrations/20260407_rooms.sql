-- Tabela de salas: garante unicidade (1 sala por campus + curso + ano_turma)
CREATE TABLE IF NOT EXISTS rooms (
  class_code TEXT PRIMARY KEY,
  campus     TEXT NOT NULL,
  curso      TEXT NOT NULL,
  ano_turma  TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campus, curso, ano_turma)
);

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
-- Leitura pública (para verificar se sala existe no cadastro)
CREATE POLICY "rooms_select_all" ON rooms FOR SELECT USING (true);
-- Insert via service role apenas
CREATE POLICY "rooms_insert_service" ON rooms FOR INSERT WITH CHECK (true);

-- Sincroniza salas já existentes nos perfis
INSERT INTO rooms (class_code, campus, curso, ano_turma)
SELECT DISTINCT ON (campus, curso, ano_turma)
  class_code, campus, curso, ano_turma
FROM profiles
WHERE class_code IS NOT NULL
  AND campus    IS NOT NULL
  AND curso     IS NOT NULL
  AND ano_turma IS NOT NULL
ORDER BY campus, curso, ano_turma, created_at
ON CONFLICT DO NOTHING;
