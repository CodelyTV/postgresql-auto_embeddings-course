CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE OR REPLACE FUNCTION generate_embedding(
)
	RETURNS TRIGGER
	LANGUAGE plpgsql
AS
$$
DECLARE
	text_content TEXT;
	request_id BIGINT;
	response_body jsonb;
	embedding_array DOUBLE PRECISION[];
	api_url TEXT := 'http://1-generate_on_trigger-ollama-1:11434/api/embeddings';
BEGIN
	text_content := new.name || ' ' || new.summary;

	request_id := net.http_post(
		url := api_url,
		body := JSONB_BUILD_OBJECT(
			'model', 'nomic-embed-text',
			'prompt', text_content
				),
		headers := JSONB_BUILD_OBJECT('Content-Type', 'application/json')
				  );

	SELECT (response).body::jsonb
	INTO response_body
	FROM net.http_collect_response(request_id, async:=false);

	SELECT ARRAY_AGG(e::DOUBLE PRECISION)
	INTO embedding_array
	FROM JSONB_ARRAY_ELEMENTS_TEXT(response_body -> 'embedding') AS e;

	-- Cast the array to the vector type
	new.embedding = embedding_array::vector;

	RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg__courses__generate_embedding_before_insert ON mooc.courses;

CREATE TRIGGER trg__courses__generate_embedding_before_insert
	BEFORE INSERT
	ON mooc.courses
	FOR EACH ROW
EXECUTE FUNCTION generate_embedding();
