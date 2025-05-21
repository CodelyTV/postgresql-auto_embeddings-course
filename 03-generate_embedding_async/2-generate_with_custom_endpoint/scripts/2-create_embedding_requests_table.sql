CREATE TABLE net.embedding_requests (
	request_id BIGINT NOT NULL,
	table_name TEXT NOT NULL
);

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
	api_url TEXT := 'http://2-generate_with_custom_endpoint-ollama-1:11434/api/embeddings';
BEGIN
	query_string := 'SELECT ' || embedding_input_func_name || '($1)';
	EXECUTE query_string INTO text_content USING new;

	SELECT net.http_post(
		url := api_url,
		body := JSONB_BUILD_OBJECT(
			'model', 'nomic-embed-text',
			'prompt', text_content
		),
		headers := JSONB_BUILD_OBJECT('Content-Type', 'application/json')
	)
	INTO request_id;

	INSERT INTO net.embedding_requests (request_id, table_name) VALUES (request_id, schema_name || '.' || table_name);

	new.request_id = request_id;

	RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION net._http_response__handle_embedding_response(
)
	RETURNS TRIGGER
	LANGUAGE plpgsql
AS
$$
DECLARE
	embedding_array FLOAT[];
	table_name_with_schema TEXT;
BEGIN
	SELECT ARRAY_AGG(e::DOUBLE PRECISION)
	INTO embedding_array
	FROM JSONB_ARRAY_ELEMENTS_TEXT(new.content::jsonb -> 'embedding') AS e;

	SELECT table_name FROM net.embedding_requests WHERE request_id = new.id INTO table_name_with_schema;

	EXECUTE FORMAT('UPDATE %s SET embedding = $1::vector WHERE request_id = $2', table_name_with_schema)
		USING embedding_array, new.id;
	RETURN new;
END;
$$;
