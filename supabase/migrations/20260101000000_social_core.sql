begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username \~ '^\[a-z0-9\_\]{3,30}$'),
  display\_name text not null check (char\_length(btrim(display\_name)) between 1 and 80),
  bio text not null default '' check (char\_length(bio) &lt;= 500),
  is\_private boolean not null default false,
  created\_at timestamptz not null default now()
);
create table public.follows (
  follower\_id uuid references public.profiles on delete cascade,
  followed\_id uuid references public.profiles on delete cascade,
  accepted boolean not null default false,
  created\_at timestamptz not null default now(),
  primary key (follower\_id, followed\_id), check (follower\_id &lt;&gt; followed\_id)
);
create index follows\_incoming on public.follows (followed\_id, follower\_id);
create table public.blocks (
  blocker\_id uuid references public.profiles on delete cascade,
  blocked\_id uuid references public.profiles on delete cascade,
  primary key (blocker\_id, blocked\_id), check (blocker\_id &lt;&gt; blocked\_id)
);
create table public.posts (
  id uuid primary key default gen\_random\_uuid(),
  author\_id uuid not null references public.profiles on delete cascade default auth.uid(),
  body text not null check (char\_length(btrim(body)) between 1 and 2000),
  created\_at timestamptz not null default now()
);
create index posts\_feed on public.posts (created\_at desc, id desc);
create index posts\_author on public.posts (author\_id, created\_at desc);
create table public.comments (
  id uuid primary key default gen\_random\_uuid(),
  post\_id uuid not null references public.posts on delete cascade,
  author\_id uuid not null references public.profiles on delete cascade default auth.uid(),
  body text not null check (char\_length(btrim(body)) between 1 and 1000),
  created\_at timestamptz not null default now()
);
create index comments\_post on public.comments (post\_id, created\_at, id);
create table public.likes (
  post\_id uuid not null references public.posts on delete cascade,
  user\_id uuid not null references public.profiles on delete cascade default auth.uid(),
  primary key (post\_id, user\_id)
);

create schema if not exists rawi\_private;
revoke all on schema rawi\_private from public;
grant usage on schema rawi\_private to authenticated;

create function rawi\_private.can\_interact(other\_id uuid) returns boolean
language sql stable security definer set search\_path = '' as $$
  select auth.uid() is not null and not exists (
    select 1 from public.blocks b where
      (b.blocker\_id = auth.uid() and b.blocked\_id = other\_id) or
      (b.blocker\_id = other\_id and b.blocked\_id = auth.uid())
  );

$$
;
create function rawi_private.can_view_owner(owner_id uuid) returns boolean
language sql stable security definer set search_path = '' as
$$

  select rawi\_private.can\_interact(owner\_id) and exists (
    select 1 from public.profiles p where p.id = owner\_id and
      (p.id = auth.uid() or not p.is\_private or exists (
        select 1 from public.follows f where f.follower\_id = auth.uid()
          and f.followed\_id = p.id and f.accepted
      ))
  );

$$
;
create function rawi_private.set_follow_status() returns trigger
language plpgsql security definer set search_path = '' as
$$

declare private\_account boolean;
begin
  select is\_private into strict private\_account from public.profiles where id = new.followed\_id for share;
  if not rawi\_private.can\_interact(new.followed\_id) then
    raise exception 'Follow unavailable' using errcode = '42501';
  end if;
  new.accepted := not private\_account;
  return new;
end;

$$
;
create trigger follows_status before insert on public.follows
for each row execute function rawi_private.set_follow_status();
create function rawi_private.remove_follows_on_block() returns trigger
language plpgsql security definer set search_path = '' as
$$

begin
  delete from public.follows f where
    (f.follower\_id = new.blocker\_id and f.followed\_id = new.blocked\_id) or
    (f.followed\_id = new.blocker\_id and f.follower\_id = new.blocked\_id);
  return new;
end;
$$;
create trigger blocks\_remove\_follows after insert on public.blocks
for each row execute function rawi\_private.remove\_follows\_on\_block();

revoke all on all functions in schema rawi\_private from public;
grant execute on function rawi\_private.can\_interact(uuid), rawi\_private.can\_view\_owner(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.likes enable row level security;
revoke all on public.profiles, public.follows, public.blocks, public.posts, public.comments, public.likes from public, anon, authenticated;
grant select on public.profiles, public.follows, public.blocks, public.posts, public.comments, public.likes to authenticated;
grant insert (id, username, display\_name, bio, is\_private), update (username, display\_name, bio, is\_private) on public.profiles to authenticated;
grant insert (follower\_id, followed\_id), update (accepted), delete on public.follows to authenticated;
grant insert (blocker\_id, blocked\_id), delete on public.blocks to authenticated;
grant insert (body), update (body), delete on public.posts to authenticated;
grant insert (post\_id, body), update (body), delete on public.comments to authenticated;
grant insert (post\_id), delete on public.likes to authenticated;

create policy profiles\_read on public.profiles for select to authenticated using (rawi\_private.can\_interact(id));
create policy profiles\_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles\_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy follows\_read on public.follows for select to authenticated using (follower\_id = auth.uid() or followed\_id = auth.uid());
create policy follows\_insert on public.follows for insert to authenticated with check (follower\_id = auth.uid() and rawi\_private.can\_interact(followed\_id));
create policy follows\_approve on public.follows for update to authenticated using (followed\_id = auth.uid() and not accepted) with check (followed\_id = auth.uid() and accepted and rawi\_private.can\_interact(follower\_id));
create policy follows\_remove on public.follows for delete to authenticated using (follower\_id = auth.uid() or followed\_id = auth.uid());
create policy blocks\_read on public.blocks for select to authenticated using (blocker\_id = auth.uid());
create policy blocks\_insert on public.blocks for insert to authenticated with check (blocker\_id = auth.uid());
create policy blocks\_remove on public.blocks for delete to authenticated using (blocker\_id = auth.uid());
create policy posts\_read on public.posts for select to authenticated using (rawi\_private.can\_view\_owner(author\_id));
create policy posts\_insert on public.posts for insert to authenticated with check (author\_id = auth.uid());
create policy posts\_update on public.posts for update to authenticated using (author\_id = auth.uid()) with check (author\_id = auth.uid());
create policy posts\_remove on public.posts for delete to authenticated using (author\_id = auth.uid());
create policy comments\_read on public.comments for select to authenticated using (rawi\_private.can\_interact(author\_id) and exists (select 1 from public.posts p where p.id = post\_id));
create policy comments\_insert on public.comments for insert to authenticated with check (author\_id = auth.uid() and exists (select 1 from public.posts p where p.id = post\_id));
create policy comments\_update on public.comments for update to authenticated using (author\_id = auth.uid()) with check (author\_id = auth.uid() and exists (select 1 from public.posts p where p.id = post\_id));
create policy comments\_remove on public.comments for delete to authenticated using (author\_id = auth.uid());
create policy likes\_read on public.likes for select to authenticated using (rawi\_private.can\_interact(user\_id) and exists (select 1 from public.posts p where p.id = post\_id));
create policy likes\_insert on public.likes for insert to authenticated with check (user\_id = auth.uid() and exists (select 1 from public.posts p where p.id = post\_id));
create policy likes\_remove on public.likes for delete to authenticated using (user\_id = auth.uid());

commit;