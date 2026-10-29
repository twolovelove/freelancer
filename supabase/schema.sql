-- 작업 기록 동기화용 테이블
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run 하세요. (한 번만)

create table if not exists public.worklog_items (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  kind       text        not null,              -- record / running / break / category / meta
  id         text        not null,
  data       jsonb,
  deleted    boolean     not null default false, -- 삭제 표시 (다른 기기에도 삭제를 전달)
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);

create index if not exists worklog_items_user_updated on public.worklog_items (user_id, updated_at);

-- 로그인한 본인 데이터만 읽고 쓸 수 있게
alter table public.worklog_items enable row level security;

drop policy if exists "own rows" on public.worklog_items;
create policy "own rows" on public.worklog_items
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 수정 시각은 서버 시계로 기록 (기기마다 시계가 달라도 안전하게)
create or replace function public.worklog_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists worklog_touch on public.worklog_items;
create trigger worklog_touch before insert or update on public.worklog_items
  for each row execute function public.worklog_touch();
