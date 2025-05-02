-- Queue for processing embedding jobs
select pgmq.create('embedding_jobs');

-- Generic trigger function to queue embedding jobs
create or replace function util.queue_embeddings()
	returns trigger
language plpgsql
as $$
declare
	content_function text = TG_ARGV[0];
	embedding_column text = TG_ARGV[1];
begin
	perform pgmq.send(
    queue_name => 'embedding_jobs',
    msg => jsonb_build_object(
      'id', NEW.id,
      'schema', TG_TABLE_SCHEMA,
      'table', TG_TABLE_NAME,
      'contentFunction', content_function,
      'embeddingColumn', embedding_column
    )
  );
	return NEW;
end;
$$;

-- Function to process embedding jobs from the queue
create or replace function util.process_embeddings(
	batch_size int = 10,
	max_requests int = 10,
	timeout_milliseconds int = 5 * 60 * 1000 -- default 5 minute timeout
)
	returns void
	language plpgsql
as $$
declare
	job_batches jsonb[];
	batch jsonb;
begin
	with
		-- First get jobs and assign batch numbers
		numbered_jobs as (
			select
				message || jsonb_build_object('jobId', msg_id) as job_info,
				(row_number() over (order by 1) - 1) / batch_size as batch_num
			from pgmq.read(
					queue_name => 'embedding_jobs',
					vt => timeout_milliseconds / 1000,
					qty => max_requests * batch_size
				 )
		),
		-- Then group jobs into batches
		batched_jobs as (
			select
				jsonb_agg(job_info) as batch_array,
				batch_num
			from numbered_jobs
			group by batch_num
		)
	-- Finally aggregate all batches into array
	select array_agg(batch_array)
	from batched_jobs
	into job_batches;

	-- Invoke the embed edge function for each batch
	foreach batch in array job_batches loop
			perform util.invoke_edge_function(
					name => 'embed',
					body => batch,
					timeout_milliseconds => timeout_milliseconds
					);
		end loop;
end;
$$;

-- Schedule the embedding processing
select
	cron.schedule(
			'process-embeddings',
			'10 seconds',
			$$
    select util.process_embeddings();
    $$
	);
