CREATE OR REPLACE FUNCTION generate_embedding(
)
	RETURNS TRIGGER
	LANGUAGE plpgsql
AS
$$
DECLARE
	embedding_input_func_name TEXT = tg_argv[0];
	text_content TEXT;
	response_body jsonb;
	embedding_array DOUBLE PRECISION[];
	api_url TEXT := 'http://3-generate_with_pg_net-ollama-1:11434/api/embeddings';
	query_string TEXT;
BEGIN
	query_string := 'SELECT ' || embedding_input_func_name || '($1)';
	EXECUTE query_string INTO text_content USING new;

	RAISE WARNING 'Embedding input: %', text_content;

	SELECT content::jsonb
	INTO response_body
	FROM http_post(
		api_url,
		JSONB_BUILD_OBJECT(
			'model', 'nomic-embed-text',
			'prompt', text_content
		)::TEXT,
		'application/json'
		 );
		RAISE WARNING 'Embedding response: %', response_body;
	SELECT ARRAY_AGG(e::DOUBLE PRECISION)
	INTO embedding_array
	FROM JSONB_ARRAY_ELEMENTS_TEXT(response_body -> 'embedding') AS e;

	RAISE WARNING 'Embedding array: %', embedding_array;
	new.embedding = embedding_array::vector;

	RETURN new;
END;
$$;
