CREATE ROLE postgres WITH LOGIN;

create extension if not exists vector;

create extension if not exists pgmq;

create extension if not exists pg_net;

create extension if not exists pg_cron;

create extension if not exists hstore;
