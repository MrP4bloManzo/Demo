-- EJEMPLO: sustituye los correos, códigos y nombres antes de ejecutarlo.
-- 1. Primero crea cada usuario en Supabase Dashboard > Authentication > Users.
-- 2. Después ejecuta estas sentencias en SQL Editor.
-- 3. No habilites el registro público ni permitas que un usuario cambie su role.

insert into public.profiles (id, employee_code, name, role)
select id, 'ADMIN-001', 'Personal administrativo', 'HR'
from auth.users where lower(email) = lower('admin@tuempresa.com')
on conflict (id) do update set employee_code = excluded.employee_code, name = excluded.name, role = excluded.role;

insert into public.profiles (id, employee_code, name, role)
select id, 'APOYO-001', 'Ingeniería de apoyo 1', 'SUPPORT'
from auth.users where lower(email) = lower('apoyo1@tuempresa.com')
on conflict (id) do update set employee_code = excluded.employee_code, name = excluded.name, role = excluded.role;

insert into public.profiles (id, employee_code, name, role)
select id, 'APOYO-002', 'Ingeniería de apoyo 2', 'SUPPORT'
from auth.users where lower(email) = lower('apoyo2@tuempresa.com')
on conflict (id) do update set employee_code = excluded.employee_code, name = excluded.name, role = excluded.role;

insert into public.profiles (id, employee_code, name, role)
select id, 'IDC-001', 'Ingeniero de campo 1', 'IDC'
from auth.users where lower(email) = lower('idc1@tuempresa.com')
on conflict (id) do update set employee_code = excluded.employee_code, name = excluded.name, role = excluded.role;

insert into public.profiles (id, employee_code, name, role)
select id, 'IDC-002', 'Ingeniero de campo 2', 'IDC'
from auth.users where lower(email) = lower('idc2@tuempresa.com')
on conflict (id) do update set employee_code = excluded.employee_code, name = excluded.name, role = excluded.role;

insert into public.profiles (id, employee_code, name, role)
select id, 'IDC-003', 'Ingeniero de campo 3', 'IDC'
from auth.users where lower(email) = lower('idc3@tuempresa.com')
on conflict (id) do update set employee_code = excluded.employee_code, name = excluded.name, role = excluded.role;

-- Esta consulta debe devolver todos los perfiles creados.
select employee_code, name, role from public.profiles order by role, employee_code;
