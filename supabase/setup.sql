-- Annotated.com global chat: run this once in your Supabase project (SQL Editor -> New query -> Run).
-- It is safe to run again; it only adds what's missing and refreshes the rules.
--
-- Who can do what:
--   * Anyone with the extension can read every post.
--   * Each install signs in anonymously and posts as itself (at most 10 posts a minute, counted even
--     if they're deleted again).
--   * You can delete only your own posts and files. Nobody can edit a post.
--   * Only annotations (a picture or video with its source link) go to everyone. Everything else is a
--     reply to an annotation, and a reply can't be replied to. The reply keeps a short quote of what it
--     answers (filled in here, not by the app).
--   * Anyone signed in can like a post (once each) and take the like back.
--   * Each post counts how many people have seen it (its "Views", like X): everyone who has had it on
--     screen in the chat, each once. Only the count is public, not who saw what.
--   * Signing in with X shows your @handle and X photo on your posts and likes. The server fills
--     them in from the X account you signed in with, so nobody can post under someone else's handle.
--   * Pictures and videos go in a public "posts" bucket, 50 MB per file at most (the Free plan's limit),
--     named <your id>/<random id>.<type>, at most 40 an hour. A post's file has to be uploaded first,
--     each file is one post's, and a file a post uses can't be replaced (nor one a claim keeps, deleted).
--   * Anyone signed in can file a claim on someone else's post (it uses their work beyond fair use).
--     Claims are private: only the project's owners read them (Table Editor → claims).

-- 1) Posts ---------------------------------------------------------------------------------------

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  body text not null default '' check (char_length(body) <= 2000),
  media_path text check (media_path is null or char_length(media_path) <= 300),
  media_type text check (media_type in ('image', 'video')),
  media_mime text check (media_mime is null or char_length(media_mime) <= 60),
  media_width integer check (media_width is null or media_width between 1 and 20000),
  media_height integer check (media_height is null or media_height between 1 and 20000),
  media_bytes bigint check (media_bytes is null or media_bytes between 1 and 52428800),
  media_seconds real check (media_seconds is null or media_seconds between 0 and 7200),
  source text check (source is null or char_length(source) <= 2048),
  constraint messages_has_content check (char_length(body) > 0 or media_path is not null),
  constraint messages_media_pair check ((media_path is null) = (media_type is null))
);

-- Replies: which post this answers, and a short quote of it (name, first words or picture/video). If that
-- post is deleted, the quote says so instead.
alter table public.messages add column if not exists reply_to uuid references public.messages (id) on delete set null;
alter table public.messages add column if not exists reply_name text;
alter table public.messages add column if not exists reply_text text;
alter table public.messages add column if not exists reply_media text;
alter table public.messages add column if not exists reply_gone boolean not null default false;
alter table public.messages add column if not exists reply_path text; -- its picture or video, for a thumbnail
create index if not exists messages_reply_to_idx on public.messages (reply_to);
-- Replies made before reply_path existed get it too.
update public.messages r set reply_path = m.media_path
  from public.messages m
  where r.reply_to = m.id and r.reply_path is null and m.media_path is not null;

-- Sign in with X: the poster's X handle and photo (empty without X). Filled in by the server only.
alter table public.messages add column if not exists x_handle text;
alter table public.messages add column if not exists x_avatar text;

-- How many people have seen the post (see 3, Views). Kept on the post, so it comes with it and changes
-- live. Counted by the server only.
alter table public.messages add column if not exists views integer not null default 0;

-- What each person did in the last hour (posted, liked, filed a claim), for the rate limits: unlike the
-- posts and likes themselves, deleting doesn't take it back. Only the server's own functions use it.
create table if not exists public.chat_activity (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists chat_activity_user_kind_at_idx on public.chat_activity (user_id, kind, at);
alter table public.chat_activity enable row level security;
revoke all on public.chat_activity from anon, authenticated;

-- At most "most" of "kind" per "per" for this person, counted one request at a time (concurrent requests
-- wait for each other), then logged. Raises "Slow down" past it.
create or replace function public.chat_limit(uid uuid, kind text, most integer, per interval, what text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(kind || ':' || uid::text, 0));
  if (
    select count(*) from public.chat_activity a
    where a.user_id = uid and a.kind = chat_limit.kind and a.at > now() - per
  ) >= most then
    raise exception 'Slow down: at most % %.', most, what using errcode = 'P0001';
  end if;
  insert into public.chat_activity (user_id, kind) values (uid, kind);
  delete from public.chat_activity a where a.user_id = uid and a.at < now() - interval '1 day';
end;
$$;
revoke all on function public.chat_limit(uuid, text, integer, interval, text) from public, anon, authenticated;

-- A plain name can't pass for an @handle: no @ in it anywhere, and no invisible or blank-looking
-- characters (which could hide where a name starts).
create or replace function public.chat_clean_name(name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(btrim(regexp_replace(regexp_replace(
    regexp_replace(name, '[\u00AD\u034F\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0]', '', 'g'),
    '[@＠﹫]', '', 'g'),
    '[[:space:]]+', ' ', 'g')), ''), 'Someone')
$$;

-- A file's path is <your id>/<random id>.<type>, and the type matches what the post says it is.
do $$
begin
  alter table public.messages add constraint messages_media_path_shape check (
    media_path is null or (
      media_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp|gif|mp4|webm)$'
      and (media_type = 'video') = (media_path ~ '\.(mp4|webm)$')
    )
  );
exception
  when duplicate_object then null; -- already there
end;
$$;

create index if not exists messages_created_at_idx on public.messages (created_at desc);
create index if not exists messages_user_created_idx on public.messages (user_id, created_at desc);
create index if not exists messages_media_path_idx on public.messages (media_path) where media_path is not null;
-- Each file is one post's (when no two posts share one already: then it stays as it is, and says so).
do $$
begin
  if exists (select media_path from public.messages where media_path is not null group by media_path having count(*) > 1) then
    raise notice 'Some posts share a file: each file isn''t made one post''s yet.';
  else
    create unique index if not exists messages_media_path_key on public.messages (media_path) where media_path is not null;
    drop index if exists public.messages_media_path_idx;
  end if;
end;
$$;

-- Only what the chat needs (new tables aren't exposed automatically): everyone reads, signed-in
-- people post and delete. Nobody updates. The rules below then narrow it to your own posts.
grant usage on schema public to anon, authenticated;
revoke all on public.messages from anon, authenticated;
grant select on public.messages to anon, authenticated;
grant insert, delete on public.messages to authenticated;

alter table public.messages enable row level security;

drop policy if exists "Anyone can read posts" on public.messages;
create policy "Anyone can read posts" on public.messages
  for select to anon, authenticated
  using (true);

drop policy if exists "Post as yourself" on public.messages;
create policy "Post as yourself" on public.messages
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (media_path is null or split_part(media_path, '/', 1) = (select auth.uid())::text)
  );

drop policy if exists "Delete your own posts" on public.messages;
create policy "Delete your own posts" on public.messages
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- The X account someone signed in with: their handle and photo, from Supabase Auth's own record of
-- it (checked: a real handle, a photo on X's image server). Only the server's own functions use it.
create or replace function public.chat_x_profile(uid uuid, out handle text, out avatar text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  select
    case when x.h ~ '^[A-Za-z0-9_]{1,15}$' then x.h end,
    case when x.a ~ '^https://pbs\.twimg\.com/' then left(x.a, 400) end
  into handle, avatar
  from (
    select coalesce(i.identity_data->>'user_name', i.identity_data->>'preferred_username') as h,
           coalesce(i.identity_data->>'avatar_url', i.identity_data->>'picture') as a
    from auth.identities i
    where i.user_id = uid and i.provider in ('x', 'twitter')
    order by i.updated_at desc nulls last
    limit 1
  ) x;
exception
  when insufficient_privilege or undefined_table or undefined_column then
    handle := null; -- can't look: posting still works, just without the handle
    avatar := null;
end;
$$;
revoke all on function public.chat_x_profile(uuid) from public, anon, authenticated;

-- The server stamps the time, puts your X handle and photo on (if you signed in with X; never what the
-- app sends), fills in a reply's quote, starts the views at 0, and keeps anyone to 10 posts a minute.
-- It reads Supabase Auth's record of your X account, so it runs with the table owner's rights; it's a
-- trigger, so nobody can call it.
create or replace function public.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent public.messages%rowtype;
begin
  new.created_at := now();
  select p.handle, p.avatar into new.x_handle, new.x_avatar from public.chat_x_profile(new.user_id) p;
  new.name := public.chat_clean_name(new.name);
  -- No direction overrides in what's written (with them, a link could show one address and open another).
  new.body := regexp_replace(new.body, '[\u202A-\u202E\u2066-\u2069]', '', 'g');
  -- A picture or video has to be uploaded first, by you, at that place.
  if new.media_path is not null and not exists (
    select 1 from storage.objects o where o.bucket_id = 'posts' and o.name = new.media_path and o.owner_id = new.user_id::text
  ) then
    raise exception 'Upload the picture or video first.' using errcode = 'P0001';
  end if;
  new.reply_name := null;
  new.reply_text := null;
  new.reply_media := null;
  new.reply_path := null;
  new.reply_gone := false;
  new.views := 0;
  -- Where it's from is a web link (the chat makes it one: http or https).
  if new.source is not null and new.source !~* '^https?://[^[:space:]]+$' then
    raise exception 'Where it''s from has to be a web link.' using errcode = 'P0001';
  end if;
  if new.reply_to is null then
    -- Nobody messages everyone: what goes to everyone is an annotation (a picture or video with where
    -- it's from).
    if new.media_path is null or new.source is null then
      raise exception 'Only annotations go to everyone: to say something, reply to one.' using errcode = 'P0001';
    end if;
  else
    select * into parent from public.messages m where m.id = new.reply_to;
    if not found then
      raise exception 'That post isn''t in the chat any more.' using errcode = 'P0001';
    end if;
    -- Only an annotation can be replied to (not a reply).
    if parent.reply_to is not null or parent.reply_gone or parent.media_path is null or parent.source is null then
      raise exception 'Only annotations can be replied to.' using errcode = 'P0001';
    end if;
    new.reply_name := case when parent.x_handle is not null then '@' || parent.x_handle else parent.name end;
    new.reply_text := left(parent.body, 140);
    new.reply_media := parent.media_type;
    new.reply_path := parent.media_path;
  end if;
  perform public.chat_limit(new.user_id, 'post', 10, interval '1 minute', 'posts a minute');
  return new;
end;
$$;

revoke all on function public.messages_before_insert() from public, anon, authenticated;

drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert
  before insert on public.messages
  for each row execute function public.messages_before_insert();

-- Deleting a post: replies to it keep only "deleted" (their quote of it goes too). This changes other
-- people's posts, so it runs with the table owner's rights; it's a trigger, so nobody can call it. It
-- runs after the delete (and its name sorts before the database's own clean-up of reply_to), so a post
-- deleted together with a reply to it (a user's posts all at once, say) goes cleanly.
create or replace function public.messages_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.messages
    set reply_to = null, reply_gone = true, reply_name = null, reply_text = null, reply_media = null, reply_path = null
    where reply_to = old.id;
  return null;
end;
$$;
revoke all on function public.messages_after_delete() from public, anon, authenticated;

drop trigger if exists messages_before_delete on public.messages;
drop function if exists public.messages_before_delete();
drop trigger if exists "A_messages_after_delete" on public.messages;
create trigger "A_messages_after_delete"
  after delete on public.messages
  for each row execute function public.messages_after_delete();

-- Live updates: new and deleted posts are pushed to everyone who has the chat open.
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null; -- already added
end;
$$;

-- 2) Likes -----------------------------------------------------------------------------------------

create table if not exists public.likes (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- Sign in with X: the liker's X handle and photo (empty without X). Filled in by the server only.
alter table public.likes add column if not exists x_handle text;
alter table public.likes add column if not exists x_avatar text;

create index if not exists likes_user_idx on public.likes (user_id);

revoke all on public.likes from anon, authenticated;
grant select on public.likes to anon, authenticated;
grant insert, delete on public.likes to authenticated;

alter table public.likes enable row level security;

drop policy if exists "Anyone can see likes" on public.likes;
create policy "Anyone can see likes" on public.likes
  for select to anon, authenticated
  using (true);

drop policy if exists "Like as yourself" on public.likes;
create policy "Like as yourself" on public.likes
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Take back your own like" on public.likes;
create policy "Take back your own like" on public.likes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- The server stamps the time, puts your X handle and photo on, and keeps anyone to 60 likes a minute.
create or replace function public.likes_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := now();
  select p.handle, p.avatar into new.x_handle, new.x_avatar from public.chat_x_profile(new.user_id) p;
  new.name := public.chat_clean_name(new.name);
  perform public.chat_limit(new.user_id, 'like', 60, interval '1 minute', 'likes a minute');
  return new;
end;
$$;

revoke all on function public.likes_before_insert() from public, anon, authenticated;

drop trigger if exists likes_before_insert on public.likes;
create trigger likes_before_insert
  before insert on public.likes
  for each row execute function public.likes_before_insert();

do $$
begin
  alter publication supabase_realtime add table public.likes;
exception
  when duplicate_object then null; -- already added
end;
$$;

-- After signing in with X (or changing your X handle or photo): your earlier posts and likes, and
-- replies' quotes of your posts, get your @handle and photo too. Only ever your own.
create or replace function public.chat_refresh_me()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  xh text;
  xa text;
begin
  if me is null then
    return;
  end if;
  select p.handle, p.avatar into xh, xa from public.chat_x_profile(me) p;
  update public.messages set x_handle = xh, x_avatar = xa
    where user_id = me and (x_handle is distinct from xh or x_avatar is distinct from xa);
  update public.likes set x_handle = xh, x_avatar = xa
    where user_id = me and (x_handle is distinct from xh or x_avatar is distinct from xa);
  if xh is not null then
    update public.messages r set reply_name = '@' || xh
      from public.messages m
      where r.reply_to = m.id and m.user_id = me and r.reply_name is distinct from '@' || xh;
  end if;
end;
$$;
revoke all on function public.chat_refresh_me() from public, anon;
grant execute on function public.chat_refresh_me() to authenticated;

-- 3) Views -----------------------------------------------------------------------------------------

-- Who has seen which post, so each person counts once. Nobody can read or change it directly.
create table if not exists public.views (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists views_user_idx on public.views (user_id);
alter table public.views enable row level security;
revoke all on public.views from anon, authenticated;

-- The chat calls this with the posts you've had on screen: you count once on each, and their counts
-- are brought up to date. It writes the counts on other people's posts, so it runs with the table
-- owner's rights; it only ever counts you.
create or replace function public.chat_seen(ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  fresh uuid[];
begin
  if me is null or ids is null or cardinality(ids) = 0 then
    return;
  end if;
  with added as (
    insert into public.views (message_id, user_id)
    select m.id, me from public.messages m where m.id = any (ids[1:100])
    on conflict do nothing
    returning message_id
  )
  select coalesce(array_agg(message_id), '{}') into fresh from added;
  if cardinality(fresh) > 0 then
    update public.messages m set views = m.views + 1 where m.id = any (fresh);
  end if;
end;
$$;
revoke all on function public.chat_seen(uuid[]) from public, anon;
grant execute on function public.chat_seen(uuid[]) to authenticated;

-- 4) Pictures and videos -------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'posts', 'posts', true, 52428800,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- How many files you've uploaded in the last hour (a policy can't look at its own table, so this does).
create or replace function public.chat_recent_uploads()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from storage.objects o
  where o.bucket_id = 'posts' and o.owner_id = (select auth.jwt() ->> 'sub') and o.created_at > now() - interval '1 hour'
$$;
revoke all on function public.chat_recent_uploads() from public, anon;
grant execute on function public.chat_recent_uploads() to authenticated;

-- Whether a claim keeps a file (a copy of the post it's about): it isn't deleted or replaced then.
create or replace function public.chat_file_kept(path text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (select 1 from public.claims c where c.post_media = path);
exception
  when undefined_table then
    return false; -- (no claims yet: set up below)
end;
$$;
revoke all on function public.chat_file_kept(text) from public, anon;
grant execute on function public.chat_file_kept(text) to authenticated;

-- Whether no post uses a file at this place (one that does can't be deleted and uploaded again as
-- something else: nobody can change a post).
create or replace function public.chat_path_unused(path text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return not exists (select 1 from public.messages m where m.media_path = path)
    and not public.chat_file_kept(path);
end;
$$;
revoke all on function public.chat_path_unused(text) from public, anon;
grant execute on function public.chat_path_unused(text) to authenticated;

-- Upload only into a folder named after yourself, named the way the chat names files
-- (posts/<your id>/<random id>.<type>), at most 40 files an hour, and never in place of a post's file.
drop policy if exists "Upload into your own folder" on storage.objects;
create policy "Upload into your own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'posts'
    and (storage.foldername(name))[1] = (select auth.jwt() ->> 'sub')
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp|gif|mp4|webm)$'
    and public.chat_recent_uploads() < 40
    and public.chat_path_unused(name)
  );

-- Removing a file needs to see it and delete it; only your own.
drop policy if exists "See your own files" on storage.objects;
create policy "See your own files" on storage.objects
  for select to authenticated
  using (bucket_id = 'posts' and owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists "Delete your own files" on storage.objects;
create policy "Delete your own files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'posts' and owner_id = (select auth.jwt() ->> 'sub') and not public.chat_file_kept(name));

-- 5) Claims ------------------------------------------------------------------------------------------

-- "File a claim" on a post: someone says it uses their work beyond fair use. Claims are private: only
-- the project's owners read them (Supabase dashboard → Table Editor → claims); nobody else can read,
-- change or delete them. One claim per person per post, at most 10 an hour, not on your own posts. The
-- server keeps a copy of the post with the claim, in case the post is deleted.
create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message_id uuid references public.messages (id) on delete set null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reason text not null check (char_length(reason) between 10 and 2000),
  contact text not null check (char_length(contact) between 3 and 200),
  post_user uuid,
  post_name text,
  post_body text,
  post_media text,
  post_source text,
  unique (message_id, user_id)
);
create index if not exists claims_user_idx on public.claims (user_id);
alter table public.claims enable row level security;
revoke all on public.claims from anon, authenticated;
grant insert on public.claims to authenticated;

drop policy if exists "File a claim as yourself" on public.claims;
create policy "File a claim as yourself" on public.claims
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create or replace function public.claims_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := now();
  select m.user_id, case when m.x_handle is not null then '@' || m.x_handle else m.name end, m.body, m.media_path, m.source
    into new.post_user, new.post_name, new.post_body, new.post_media, new.post_source
    from public.messages m
    where m.id = new.message_id;
  if not found then
    raise exception 'That post isn''t in the chat any more.' using errcode = 'P0001';
  end if;
  if new.post_user = new.user_id then
    raise exception 'That''s your own post.' using errcode = 'P0001';
  end if;
  perform public.chat_limit(new.user_id, 'claim', 10, interval '1 hour', 'claims an hour');
  return new;
end;
$$;
revoke all on function public.claims_before_insert() from public, anon, authenticated;

drop trigger if exists claims_before_insert on public.claims;
create trigger claims_before_insert
  before insert on public.claims
  for each row execute function public.claims_before_insert();

-- 6) Names made before the rules above --------------------------------------------------------------

-- Names posted before a name could have no @ in it, and replies' quotes of them.
update public.messages set name = public.chat_clean_name(name) where name is distinct from public.chat_clean_name(name);
update public.likes set name = public.chat_clean_name(name) where name is distinct from public.chat_clean_name(name);
update public.messages r set reply_name = case when m.x_handle is not null then '@' || m.x_handle else m.name end
  from public.messages m
  where r.reply_to = m.id and r.reply_name is distinct from (case when m.x_handle is not null then '@' || m.x_handle else m.name end);
