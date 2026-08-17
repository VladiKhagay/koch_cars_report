-- ===========================================================================
-- 0010 — make the RPC grants mean what every previous migration said
--
-- Since 0001 each security definer function has ended with the same pair:
--
--   revoke all on function f(...) from public;
--   grant execute on function f(...) to authenticated;
--
-- read by everyone since as "only signed-in users can call this". It is not
-- what happens. Supabase ships default privileges that grant EXECUTE on new
-- public-schema functions to anon, authenticated and service_role explicitly.
-- `revoke ... from public` removes the PUBLIC pseudo-role grant and leaves the
-- explicit grant to `anon` untouched — so every one of these has been callable
-- with the publishable anon key, unauthenticated, from anywhere.
--
-- Verified against the live project before writing this, with the anon key:
--
--   admin_lookup_auth_id           400 'forbidden'
--   set_user_active                400 'forbidden'
--   update_customer_report_config  400 'forbidden'
--   update_my_name                 204 (executed)
--   can_write_job                  200 false
--
-- Nothing was exploitable. The first three are stopped by their own
-- current_app_user() checks, can_write_job returns false because there is no
-- app user in context, and update_my_name is a no-op because it filters on
-- `auth_id = auth.uid()` and auth.uid() is null — `auth_id = null` matches no
-- rows. That last one is the uncomfortable case: it is safe by a NULL
-- comparison, not by a decision. It has no authorization check of its own.
--
-- Two changes, and the second is the one that matters long term:
--   1. Actually revoke from anon, so the grant line stops being decorative.
--   2. Give update_my_name the explicit guard the others already have, so it
--      is not the one function relying on SQL's NULL semantics to be safe.
--
-- The frontend calls none of these before sign-in — login and invite
-- acceptance go through supabase.auth, not PostgREST — so nothing legitimate
-- loses access here.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Close the grant
-- ---------------------------------------------------------------------------

revoke execute on function current_app_user() from anon;
revoke execute on function admin_lookup_auth_id(text) from anon;
revoke execute on function find_recent_duplicate(uuid, text) from anon;
revoke execute on function update_my_name(text) from anon;
revoke execute on function set_user_active(uuid, boolean) from anon;
revoke execute on function update_customer_report_config(jsonb) from anon;
revoke execute on function can_write_job(uuid) from anon;

-- Future functions inherit the same default that caused this, so change the
-- default too rather than relying on remembering the revoke each time.
alter default privileges in schema public revoke execute on functions from anon;

-- ---------------------------------------------------------------------------
-- 2. update_my_name defends itself
--
-- Behaviour for a signed-in caller is unchanged: same validation, same single
-- row updated. The only difference is that an anonymous call now says no
-- instead of quietly succeeding against zero rows.
-- ---------------------------------------------------------------------------

create or replace function update_my_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'forbidden';
  end if;
  if p_name is null or length(trim(p_name)) = 0 or length(p_name) > 100 then
    raise exception 'invalid name';
  end if;
  update users set name = trim(p_name) where auth_id = auth.uid();
end;
$$;

revoke all on function update_my_name(text) from public;
revoke execute on function update_my_name(text) from anon;
grant execute on function update_my_name(text) to authenticated;

commit;
