-- Pega esto en Supabase → SQL Editor → New query → Run.
-- Crea la tabla donde Wendy guarda lo que aprende cuando está en internet.
create table if not exists public.aprendidos (
  id bigint generated always as identity primary key,
  clave text unique not null,          -- la pregunta principal (normalizada)
  preguntas text[] not null,           -- formas de preguntarlo
  respuestas text[] not null,          -- lo que Wendy responde
  origen text not null default 'voz',  -- 'voz' (se lo enseñaste) o 'gemini' (lo aprendió sola)
  creado timestamptz not null default now()
);

-- Seguridad: nadie puede leer ni escribir desde el navegador.
-- Solo el servidor de Wendy, con la clave secreta, puede usar la tabla.
alter table public.aprendidos enable row level security;
