-- Add shot tracking columns to session_logs for basketball drills
alter table session_logs
  add column if not exists shot_attempts integer check (shot_attempts >= 0),
  add column if not exists shot_makes integer check (shot_makes >= 0);

-- makes can't exceed attempts
alter table session_logs
  add constraint shot_makes_lte_attempts
    check (shot_makes is null or shot_attempts is null or shot_makes <= shot_attempts);
