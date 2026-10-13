-- Run once in the existing Neon database to allow persisted two-player chase games.
ALTER TABLE game_sessions
  DROP CONSTRAINT IF EXISTS game_sessions_game_type_check;

ALTER TABLE game_sessions
  ADD CONSTRAINT game_sessions_game_type_check
  CHECK (game_type IN ('tic_tac_toe', 'chase', 'quiz', 'would_you_rather'));
