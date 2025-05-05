ALTER TABLE mooc.courses ADD COLUMN request_id BIGINT;

CREATE OR REPLACE FUNCTION generate_embedding(
)
	RETURNS TRIGGER
	LANGUAGE plpgsql
AS
$$
DECLARE
	text_content TEXT;
	request_id BIGINT;
	api_url TEXT := 'http://1-generate_on_trigger-ollama-1:11434/api/embeddings';
BEGIN
	text_content := new.name || ' ' || new.summary;

	SELECT net.http_post(
		url := api_url,
		body := JSONB_BUILD_OBJECT(
			'model', 'nomic-embed-text',
			'prompt', text_content
		),
		headers := JSONB_BUILD_OBJECT('Content-Type', 'application/json')
	)
	INTO request_id;

	RAISE WARNING 'Request ID: %', request_id;

	new.request_id = request_id;

	RETURN new;
END;
$$;

CREATE OR REPLACE TRIGGER trg__courses__generate_embedding_before_insert
	BEFORE INSERT
	ON mooc.courses
	FOR EACH ROW
EXECUTE FUNCTION generate_embedding();


CREATE OR REPLACE FUNCTION handle_embedding_response(
)
	RETURNS TRIGGER
	LANGUAGE plpgsql
AS
$$
DECLARE
	embedding_array FLOAT[];
BEGIN
	SELECT ARRAY_AGG(e::DOUBLE PRECISION)
	INTO embedding_array
	FROM JSONB_ARRAY_ELEMENTS_TEXT(new.content::jsonb -> 'embedding') AS e;

	UPDATE mooc.courses
	SET embedding = embedding_array::vector
	WHERE request_id = new.id;

	RETURN new;
END;
$$;

-- Create trigger for HTTP response
CREATE OR REPLACE TRIGGER trg__net_responses__handle_embedding
	AFTER INSERT
	ON net._http_response
	FOR EACH ROW
EXECUTE FUNCTION handle_embedding_response();
