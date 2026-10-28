-- Row counts of every app table: the same query is used to compare a source
-- database with a restored copy. A restore is verified when the numbers match.
SELECT 'food_entries', count(*) FROM food_entries
UNION ALL SELECT 'workout_sessions', count(*) FROM workout_sessions
UNION ALL SELECT 'exercise_sets', count(*) FROM exercise_sets
UNION ALL SELECT 'cardio_sessions', count(*) FROM cardio_sessions
UNION ALL SELECT 'daily_activity', count(*) FROM daily_activity
UNION ALL SELECT 'body_measurements', count(*) FROM body_measurements
UNION ALL SELECT 'daily_notes', count(*) FROM daily_notes
UNION ALL SELECT 'target_sets', count(*) FROM target_sets
UNION ALL SELECT 'profiles', count(*) FROM profiles
UNION ALL SELECT 'owners', count(*) FROM owners
UNION ALL SELECT '_prisma_migrations', count(*) FROM _prisma_migrations;
