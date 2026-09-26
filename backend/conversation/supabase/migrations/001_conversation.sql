-- Tables used by the conversation backend (see Conversational_System_implementation_plan.md, section 5).
-- Scoring and dashboard tables are owned by other parts of the system and are not created here.
--
-- HACKATHON ONLY: the RLS policies at the bottom are deliberately permissive so the frontend
-- can use the anon key. They must be locked down before any real patient data is stored.

create table if not exists patients (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    age int,
    proxy_name text,
    modules text[] not null default '{}',
    checkin_time time
);

create table if not exists checkin_requests (
    id uuid primary key default gen_random_uuid(),
    patient_id uuid not null references patients (id) on delete cascade,
    created_at timestamptz not null default now(),
    status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed'))
);

create table if not exists device_state (
    patient_id uuid primary key references patients (id) on delete cascade,
    state text not null default 'idle'
        check (state in ('idle', 'ringing', 'listening', 'thinking', 'speaking', 'alert')),
    updated_at timestamptz not null default now()
);

-- status and ended_at are written last; a row with ended_at set is final.
create table if not exists checkins (
    id uuid primary key default gen_random_uuid(),
    patient_id uuid not null references patients (id) on delete cascade,
    started_at timestamptz not null default now(),
    ended_at timestamptz,
    status text check (status in ('completed', 'partial', 'missed', 'red_flag')),
    respondent text check (respondent in ('patient', 'proxy', 'unknown')),
    summary text,
    transcript jsonb not null default '[]'
);

create table if not exists checkin_fields (
    id uuid primary key default gen_random_uuid(),
    checkin_id uuid not null references checkins (id) on delete cascade,
    field text not null,
    value jsonb,
    status text not null check (status in ('complete', 'partial', 'declined', 'unclear', 'empty')),
    evidence text,
    attempts int not null default 0,
    unique (checkin_id, field)
);

create table if not exists alerts (
    id uuid primary key default gen_random_uuid(),
    patient_id uuid not null references patients (id) on delete cascade,
    checkin_id uuid references checkins (id) on delete set null,
    created_at timestamptz not null default now(),
    kind text not null check (kind in ('red_flag', 'missed_checkin')),
    message text not null,
    acknowledged boolean not null default false
);

create index if not exists checkins_patient_started_idx on checkins (patient_id, started_at desc);
create index if not exists alerts_patient_created_idx on alerts (patient_id, created_at desc);

-- RLS: the backend uses the service role key and bypasses these policies.
alter table patients enable row level security;
alter table checkin_requests enable row level security;
alter table device_state enable row level security;
alter table checkins enable row level security;
alter table checkin_fields enable row level security;
alter table alerts enable row level security;

create policy "hackathon read" on patients for select to anon, authenticated using (true);
create policy "hackathon read" on checkin_requests for select to anon, authenticated using (true);
create policy "hackathon insert" on checkin_requests for insert to anon, authenticated with check (true);
create policy "hackathon read" on device_state for select to anon, authenticated using (true);
create policy "hackathon read" on checkins for select to anon, authenticated using (true);
create policy "hackathon read" on checkin_fields for select to anon, authenticated using (true);
create policy "hackathon read" on alerts for select to anon, authenticated using (true);

alter publication supabase_realtime add table checkin_requests, device_state, checkins, alerts;
