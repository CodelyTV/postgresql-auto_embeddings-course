CREATE ROLE postgres WITH LOGIN;

-- For vector operations
create extension if not exists vector;

-- For queueing and processing jobs
-- (pgmq will create its own schema)
create extension if not exists pgmq;

-- For async HTTP requests
create extension if not exists pg_net;

-- For scheduled processing and retries
-- (pg_cron will create its own schema)
create extension if not exists pg_cron;

-- For clearing embeddings during updates
create extension if not exists hstore;
