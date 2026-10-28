-- 0023_unique_avatar.sql
-- Each preset avatar can be claimed by at most one athlete across the club.

CREATE UNIQUE INDEX IF NOT EXISTS idx_athletes_unique_avatar
  ON public.athletes (photo_path)
  WHERE photo_path IS NOT NULL;
