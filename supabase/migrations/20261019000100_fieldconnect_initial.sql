-- FieldConnect Group - esquema inicial Supabase
-- Ejecutar una sola vez en Supabase Dashboard > SQL Editor.
-- Este archivo NO necesita ni contiene una service_role/secret key.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  employee_code text not null unique,
  name text not null,
  role text not null check (role in ('HR', 'SUPPORT', 'IDC')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_code text not null unique,
  site_id text,
  project text,
  client text not null,
  site text not null,
  city text not null,
  address text,
  contact text not null,
  phone text,
  service_type text not null check (service_type in (
    'Activación de enlace', 'Instalación de APS', 'Migración a fibra',
    'Monitoreo', 'Levantamiento técnico', 'Soporte técnico'
  )),
  service_date date not null,
  service_time time not null,
  priority text not null default 'Normal' check (priority in ('Baja', 'Normal', 'Alta')),
  status text not null default 'Disponible' check (status in (
    'Disponible', 'Asignado', 'En progreso', 'En espera', 'Completado', 'Cancelado'
  )),
  assigned_to uuid references public.profiles(id) on delete set null,
  support_engineer_id uuid references public.profiles(id) on delete set null,
  scope text not null,
  tools text,
  notes text,
  fee_mxn numeric(12,2) check (fee_mxn is null or fee_mxn >= 0),
  travel_mxn numeric(12,2) not null default 0 check (travel_mxn >= 0),
  pay_status text not null default 'Por confirmar' check (pay_status in (
    'Por confirmar', 'Acordado', 'Viáticos depositados', 'Pagado'
  )),
  checklist jsonb not null default '{}'::jsonb,
  evidence_count integer not null default 0 check (evidence_count >= 0),
  close_note text not null default '',
  logs jsonb not null default '[]'::jsonb,
  created_by uuid not null references public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tickets_logs_array check (jsonb_typeof(logs) = 'array'),
  constraint tickets_checklist_object check (jsonb_typeof(checklist) = 'object')
);

create table if not exists public.ticket_evidence (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id),
  storage_path text not null unique,
  original_name text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);

create index if not exists tickets_status_date_idx on public.tickets(status, service_date, service_time);
create index if not exists tickets_assigned_to_idx on public.tickets(assigned_to);
create index if not exists tickets_support_engineer_idx on public.tickets(support_engineer_id);
create index if not exists tickets_created_by_idx on public.tickets(created_by);
create index if not exists ticket_evidence_ticket_id_idx on public.ticket_evidence(ticket_id);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();

drop trigger if exists tickets_set_updated_at on public.tickets;
create trigger tickets_set_updated_at before update on public.tickets
for each row execute function private.set_updated_at();

create or replace function private.current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles as p
  where p.id = (select auth.uid())
  limit 1;
$$;
revoke all on function private.current_role() from public, anon;
grant execute on function private.current_role() to authenticated;

alter table public.profiles enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_evidence enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.tickets from anon, authenticated;
revoke all on table public.ticket_evidence from anon, authenticated;
grant select on table public.profiles to authenticated;
grant select, insert, update on table public.tickets to authenticated;
grant select, insert on table public.ticket_evidence to authenticated;

-- La aplicación solo necesita nombres/códigos/roles del personal autenticado.
-- Los usuarios no pueden cambiar su propio role ni crear su propio perfil.
drop policy if exists profiles_read_authenticated on public.profiles;
create policy profiles_read_authenticated
on public.profiles for select to authenticated
using ((select auth.uid()) is not null);

-- RR. HH. administra todos los tickets; apoyo ve tickets sin reclamar y los suyos;
-- IDC ve servicios con logística confirmada y sus servicios asignados.
drop policy if exists tickets_select_by_role on public.tickets;
create policy tickets_select_by_role
on public.tickets for select to authenticated
using (
  (select private.current_role()) = 'HR'
  or (
    (select private.current_role()) = 'SUPPORT'
    and (
      support_engineer_id = (select auth.uid())
      or (status = 'Disponible' and assigned_to is null and support_engineer_id is null)
    )
  )
  or (
    (select private.current_role()) = 'IDC'
    and (
      assigned_to = (select auth.uid())
      or (status = 'Disponible' and assigned_to is null and support_engineer_id is not null)
    )
  )
);

drop policy if exists tickets_insert_hr on public.tickets;
create policy tickets_insert_hr
on public.tickets for insert to authenticated
with check (
  (select private.current_role()) = 'HR'
  and created_by = (select auth.uid())
);

drop policy if exists tickets_update_hr on public.tickets;
create policy tickets_update_hr
on public.tickets for update to authenticated
using ((select private.current_role()) = 'HR')
with check ((select private.current_role()) = 'HR');

-- Evidencias: únicamente RR. HH., el apoyo responsable y el IDC asignado pueden leerlas;
-- solo el IDC dueño del servicio puede subir nuevas evidencias.
drop policy if exists evidence_select_authorized on public.ticket_evidence;
create policy evidence_select_authorized
on public.ticket_evidence for select to authenticated
using (
  (select private.current_role()) = 'HR'
  or exists (
    select 1 from public.tickets t
    where t.id = ticket_evidence.ticket_id
      and (
        ((select private.current_role()) = 'SUPPORT' and t.support_engineer_id = (select auth.uid()))
        or ((select private.current_role()) = 'IDC' and t.assigned_to = (select auth.uid()))
      )
  )
);

drop policy if exists evidence_insert_assigned_idc on public.ticket_evidence;
create policy evidence_insert_assigned_idc
on public.ticket_evidence for insert to authenticated
with check (
  uploader_id = (select auth.uid())
  and (select private.current_role()) = 'IDC'
  and exists (
    select 1 from public.tickets t
    where t.id = ticket_evidence.ticket_id
      and t.assigned_to = (select auth.uid())
      and t.status in ('Asignado', 'En progreso', 'En espera')
  )
);

-- Mantiene evidence_count sincronizado con archivos reales (no con números escritos a mano).
create or replace function private.refresh_ticket_evidence_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket_id uuid;
begin
  v_ticket_id := coalesce(new.ticket_id, old.ticket_id);
  update public.tickets
  set evidence_count = (
    select count(*)::integer from public.ticket_evidence e where e.ticket_id = v_ticket_id
  )
  where id = v_ticket_id;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function private.refresh_ticket_evidence_count() from public, anon, authenticated;
drop trigger if exists ticket_evidence_count_sync on public.ticket_evidence;
create trigger ticket_evidence_count_sync
after insert or delete on public.ticket_evidence
for each row execute function private.refresh_ticket_evidence_count();

-- Reclamación atómica: dos usuarios no pueden tomar el mismo ticket simultáneamente.
create or replace function public.claim_support_ticket(p_ticket_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result uuid;
begin
  if v_uid is null or (select private.current_role()) is distinct from 'SUPPORT' then
    raise exception 'No autorizado para coordinar tickets' using errcode = '42501';
  end if;

  update public.tickets t
  set support_engineer_id = v_uid,
      logs = jsonb_build_array(jsonb_build_object(
        'title', 'Ingeniería de apoyo asignada',
        'desc', 'Se reclamó el ticket para coordinar la logística previa a la visita IDC.',
        'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
      )) || coalesce(t.logs, '[]'::jsonb)
  where t.id = p_ticket_id
    and t.status = 'Disponible'
    and t.assigned_to is null
    and t.support_engineer_id is null
  returning t.id into v_result;

  if v_result is null then
    raise exception 'El ticket ya no está disponible para ingeniería de apoyo' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;

create or replace function public.claim_idc_ticket(p_ticket_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result uuid;
begin
  if v_uid is null or (select private.current_role()) is distinct from 'IDC' then
    raise exception 'No autorizado para tomar servicios IDC' using errcode = '42501';
  end if;

  update public.tickets t
  set assigned_to = v_uid,
      status = 'Asignado',
      logs = jsonb_build_array(jsonb_build_object(
        'title', 'Servicio tomado por IDC',
        'desc', 'El ingeniero de campo reservó el servicio después de la coordinación logística.',
        'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
      )) || coalesce(t.logs, '[]'::jsonb)
  where t.id = p_ticket_id
    and t.status = 'Disponible'
    and t.assigned_to is null
    and t.support_engineer_id is not null
  returning t.id into v_result;

  if v_result is null then
    raise exception 'El servicio ya fue tomado o no tiene logística confirmada' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;

create or replace function public.save_my_ticket_progress(
  p_ticket_id uuid,
  p_checklist jsonb,
  p_close_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result uuid;
begin
  if v_uid is null or (select private.current_role()) is distinct from 'IDC' then
    raise exception 'No autorizado para actualizar avances IDC' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_checklist), '') <> 'object' then
    raise exception 'El checklist debe ser un objeto JSON';
  end if;

  update public.tickets t
  set checklist = p_checklist,
      close_note = coalesce(trim(p_close_note), ''),
      logs = jsonb_build_array(jsonb_build_object(
        'title', 'Avance actualizado por IDC',
        'desc', coalesce(nullif(trim(p_close_note), ''), 'Se actualizó el checklist del servicio.'),
        'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
      )) || coalesce(t.logs, '[]'::jsonb)
  where t.id = p_ticket_id
    and t.assigned_to = v_uid
    and t.status in ('Asignado', 'En progreso', 'En espera')
  returning t.id into v_result;

  if v_result is null then
    raise exception 'Solo puedes guardar avances de un servicio asignado a tu IDC y aún activo' using errcode = '42501';
  end if;
  return v_result;
end;
$$;

create or replace function public.set_my_ticket_status(
  p_ticket_id uuid,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ticket public.tickets%rowtype;
  v_checked integer;
begin
  if v_uid is null or (select private.current_role()) is distinct from 'IDC' then
    raise exception 'No autorizado para cambiar el estado del servicio' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('En progreso', 'En espera', 'Completado') then
    raise exception 'Estado no permitido para un IDC' using errcode = '22023';
  end if;

  select * into v_ticket from public.tickets t
  where t.id = p_ticket_id and t.assigned_to = v_uid
  for update;
  if not found then
    raise exception 'El ticket no está asignado a tu usuario' using errcode = '42501';
  end if;

  if p_status = 'En progreso' and v_ticket.status not in ('Asignado', 'En espera') then
    raise exception 'El servicio debe estar asignado o en espera para iniciar/reanudar' using errcode = 'P0001';
  elsif p_status = 'En espera' and v_ticket.status <> 'En progreso' then
    raise exception 'Solo un servicio en progreso puede ponerse en espera' using errcode = 'P0001';
  elsif p_status = 'Completado' then
    if v_ticket.status <> 'En progreso' then
      raise exception 'Inicia el servicio antes de cerrarlo' using errcode = 'P0001';
    end if;
    select count(*) into v_checked
    from (values ('0'), ('1'), ('2'), ('3'), ('4'), ('5')) as checklist_item(key)
    where v_ticket.checklist -> checklist_item.key = 'true'::jsonb;
    if v_checked < 6 then
      raise exception 'Completa los seis puntos del checklist antes del cierre' using errcode = 'P0001';
    end if;
    if length(trim(coalesce(v_ticket.close_note, ''))) = 0 then
      raise exception 'Registra la nota de visita antes del cierre' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.ticket_evidence e where e.ticket_id = v_ticket.id) then
      raise exception 'Sube al menos una fotografía o documento de evidencia antes del cierre' using errcode = 'P0001';
    end if;
  end if;

  update public.tickets t
  set status = p_status,
      completed_at = case when p_status = 'Completado' then now() else t.completed_at end,
      logs = jsonb_build_array(jsonb_build_object(
        'title', 'Estado actualizado',
        'desc', v_ticket.status || ' → ' || p_status,
        'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
      )) || coalesce(t.logs, '[]'::jsonb)
  where t.id = v_ticket.id;
  return v_ticket.id;
end;
$$;

revoke all on function public.claim_support_ticket(uuid) from public, anon;
revoke all on function public.claim_idc_ticket(uuid) from public, anon;
revoke all on function public.save_my_ticket_progress(uuid, jsonb, text) from public, anon;
revoke all on function public.set_my_ticket_status(uuid, text) from public, anon;
grant execute on function public.claim_support_ticket(uuid) to authenticated;
grant execute on function public.claim_idc_ticket(uuid) to authenticated;
grant execute on function public.save_my_ticket_progress(uuid, jsonb, text) to authenticated;
grant execute on function public.set_my_ticket_status(uuid, text) to authenticated;

-- Bucket privado para fotos/PDF de evidencia. No se generan URLs públicas.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-evidence', 'ticket-evidence', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

drop policy if exists ticket_evidence_storage_read_authorized on storage.objects;
create policy ticket_evidence_storage_read_authorized
on storage.objects for select to authenticated
using (
  bucket_id = 'ticket-evidence'
  and exists (
    select 1 from public.ticket_evidence e where e.storage_path = storage.objects.name
  )
);

drop policy if exists ticket_evidence_storage_insert_assigned_idc on storage.objects;
create policy ticket_evidence_storage_insert_assigned_idc
on storage.objects for insert to authenticated
with check (
  bucket_id = 'ticket-evidence'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (select private.current_role()) = 'IDC'
  and exists (
    select 1 from public.tickets t
    where t.id::text = (storage.foldername(name))[1]
      and t.assigned_to = (select auth.uid())
      and t.status in ('Asignado', 'En progreso', 'En espera')
  )
);

-- Permisos SQL para los objetos Storage; RLS sigue controlando cada bucket/archivo.
grant select, insert, delete on table storage.objects to authenticated;

-- Limpieza limitada de uploads huérfanos si el registro de metadata falla.
drop policy if exists ticket_evidence_storage_delete_orphaned_upload on storage.objects;
create policy ticket_evidence_storage_delete_orphaned_upload
on storage.objects for delete to authenticated
using (
  bucket_id = 'ticket-evidence'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (select private.current_role()) = 'IDC'
  and exists (
    select 1 from public.tickets t
    where t.id::text = (storage.foldername(name))[1]
      and t.assigned_to = (select auth.uid())
      and t.status in ('Asignado', 'En progreso', 'En espera')
  )
  and not exists (select 1 from public.ticket_evidence e where e.storage_path = storage.objects.name)
);

-- Habilita cambios en tiempo real para tickets y sus metadatos (si existe la publicación estándar).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tickets'
    ) then
      alter publication supabase_realtime add table public.tickets;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ticket_evidence'
    ) then
      alter publication supabase_realtime add table public.ticket_evidence;
    end if;
  end if;
end $$;

comment on table public.profiles is 'Perfil y rol operativo asignados por administración; el usuario no puede autoasignarse un rol.';
comment on table public.tickets is 'Tickets de operación de campo FieldConnect Group.';
comment on table public.ticket_evidence is 'Metadatos de evidencias almacenadas en el bucket privado ticket-evidence.';
