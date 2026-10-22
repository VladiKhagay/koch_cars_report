-- ===========================================================================
-- 0026 — the `carasso` role (client-side reader), step 1 of 5
--
-- RUN THIS FILE ALONE, as its own execution, before 0027. A new enum value
-- cannot be used in the transaction that adds it, and the Supabase SQL editor
-- runs a multi-statement paste as one implicit transaction — so this is a
-- file of one statement, and everything that names 'carasso' comes after it.
-- ===========================================================================

alter type user_role add value if not exists 'carasso';
