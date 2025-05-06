SELECT
	msg_id,
	read_ct,
	enqueued_at,
	vt,
	message
FROM pgmq.q_embedding_jobs;
SELECT now();
SELECT * FROM pgmq.meta WHERE queue_name = 'embedding_jobs';

SELECT * FROM pgmq.a_embedding_jobs;


SHOW log_min_messages;


SELECT util.process_embeddings();


SELECT jobid, schedule, command FROM cron.job;
SELECT cron.unschedule(1);

\df+ util.invoke_edge_function;
