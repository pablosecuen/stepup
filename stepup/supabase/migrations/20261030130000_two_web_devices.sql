-- Two browser/PWA devices per account. Deliberately separate from the mobile
-- app's single-writer backup lease (active_sessions): never transfer that lease.
create table public.web_device_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (device_id ~ '^web-[A-Za-z0-9._-]{8,196}$'),
  generation bigint not null default 1 check (generation > 0),
  label text not null default 'Navegador' check (length(label) between 1 and 80),
  authorized_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz,
  primary key (user_id, device_id)
);
alter table public.web_device_sessions enable row level security;
revoke all on public.web_device_sessions from anon, authenticated;
grant select on public.web_device_sessions to authenticated;
create policy web_devices_read_own on public.web_device_sessions for select to authenticated using (user_id = auth.uid());

create function public.claim_web_device(p_device_id text, p_generation bigint default null,
  p_replace_device_id text default null, p_replace_generation bigint default null, p_label text default 'Navegador')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); current_row public.web_device_sessions; replacement public.web_device_sessions; active_count integer;
begin
  if uid is null then raise exception 'Se requiere una sesión'; end if;
  if p_device_id is null or p_device_id !~ '^web-[A-Za-z0-9._-]{8,196}$' then raise exception 'Dispositivo inválido'; end if;
  -- Serializes ALL claims for this account, including the first two concurrent logins.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 30130000));
  select * into current_row from public.web_device_sessions where user_id = uid and device_id = p_device_id;
  if found and current_row.revoked_at is null and current_row.expires_at > now() then
    if p_generation is distinct from current_row.generation then raise exception 'La sesión del dispositivo cambió'; end if;
    update public.web_device_sessions set last_seen_at=now(), expires_at=now()+interval '30 days' where user_id=uid and device_id=p_device_id;
    return jsonb_build_object('status','authorized','generation',current_row.generation);
  end if;
  select count(*) into active_count from public.web_device_sessions where user_id=uid and revoked_at is null and expires_at > now();
  if active_count >= 2 then
    if p_replace_device_id is null then return jsonb_build_object('status','full'); end if;
    select * into replacement from public.web_device_sessions where user_id=uid and device_id=p_replace_device_id and revoked_at is null and expires_at>now();
    if not found or replacement.generation is distinct from p_replace_generation then return jsonb_build_object('status','changed'); end if;
    update public.web_device_sessions set revoked_at=now() where user_id=uid and device_id=p_replace_device_id;
  end if;
  insert into public.web_device_sessions(user_id,device_id,generation,label)
  values(uid,p_device_id,coalesce(current_row.generation,0)+1,left(coalesce(nullif(trim(p_label),''),'Navegador'),80))
  on conflict(user_id,device_id) do update set generation=excluded.generation,label=excluded.label,
    authorized_at=now(),last_seen_at=now(),expires_at=now()+interval '30 days',revoked_at=null;
  return jsonb_build_object('status','authorized','generation',coalesce(current_row.generation,0)+1);
end $$;

create function public.touch_web_device(p_device_id text, p_generation bigint) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Se requiere una sesión'; end if;
  update public.web_device_sessions set last_seen_at=now(),expires_at=now()+interval '30 days'
  where user_id=auth.uid() and device_id=p_device_id and generation=p_generation and revoked_at is null and expires_at>now();
end $$;

create function public.end_web_device(p_device_id text, p_generation bigint) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Se requiere una sesión'; end if;
  update public.web_device_sessions set revoked_at=now()
  where user_id=auth.uid() and device_id=p_device_id and generation=p_generation and revoked_at is null;
end $$;
revoke all on function public.claim_web_device(text,bigint,text,bigint,text) from public,anon;
revoke all on function public.touch_web_device(text,bigint) from public,anon;
revoke all on function public.end_web_device(text,bigint) from public,anon;
grant execute on function public.claim_web_device(text,bigint,text,bigint,text) to authenticated;
grant execute on function public.touch_web_device(text,bigint) to authenticated;
grant execute on function public.end_web_device(text,bigint) to authenticated;
