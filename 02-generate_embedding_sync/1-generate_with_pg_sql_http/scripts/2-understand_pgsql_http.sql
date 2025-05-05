CREATE EXTENSION IF NOT EXISTS "http";

SELECT *
FROM http_post(
	'http://1-generate_with_pg_sql_http-ollama-1:11434/api/embeddings',
	JSONB_BUILD_OBJECT(
		'model', 'nomic-embed-text',
		'prompt', 'Un curso muy guapo'
	)::text,
	'application/json'
 );
