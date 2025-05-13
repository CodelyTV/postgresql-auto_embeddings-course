CREATE OR REPLACE FUNCTION generate_embedding(
)
	RETURNS TRIGGER
	LANGUAGE plpgsql
AS
$$
DECLARE
	embedding_input_func_name TEXT = tg_argv[0];
	table_name TEXT = tg_table_name;
	schema_name TEXT = tg_table_schema;
	query_string TEXT;
	text_content TEXT;
	request_id BIGINT;
	api_url TEXT := 'http://host.docker.internal:3000/api/embeddings'; -- our server
BEGIN
	query_string := 'SELECT ' || embedding_input_func_name || '($1)';
	EXECUTE query_string INTO text_content USING new;

	SELECT net.http_post(
		url := api_url,
		body := JSONB_BUILD_OBJECT(
			'input', text_content -- only the input vs the model
		),
		headers := JSONB_BUILD_OBJECT('Content-Type', 'application/json')
	)
	INTO request_id;

	INSERT INTO net.embedding_requests (request_id, table_name) VALUES (request_id, schema_name || '.' || table_name);

	new.request_id = request_id;

	RETURN new;
END;
$$;
