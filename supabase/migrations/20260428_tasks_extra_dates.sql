-- Suporte a tarefas com múltiplos dias (ex: apresentações em 3 datas diferentes)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS extra_dates JSONB DEFAULT NULL;
