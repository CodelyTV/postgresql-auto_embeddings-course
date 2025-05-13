CREATE SCHEMA mooc;

CREATE TABLE mooc.courses (
	id CHAR(4) PRIMARY KEY NOT NULL,
	name VARCHAR(255) NOT NULL,
	summary TEXT,
	published_at DATE NOT NULL,
	embedding vector(768)
);

CREATE OR REPLACE FUNCTION generate_embedding(
)
	RETURNS TRIGGER
	LANGUAGE plpgsql
AS
$$
DECLARE
	text_content TEXT;
	response_body jsonb;
	embedding_array DOUBLE PRECISION[];
	api_url TEXT := 'http://2-reuse_embedding_generation-ollama-1:11434/api/embeddings';
BEGIN
	text_content := new.name || ' ' || new.summary;

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

	SELECT ARRAY_AGG(e::DOUBLE PRECISION)
	INTO embedding_array
	FROM JSONB_ARRAY_ELEMENTS_TEXT(response_body -> 'embedding') AS e;

	new.embedding = embedding_array::vector;

	RETURN new;
END;
$$;

CREATE OR REPLACE TRIGGER trg__courses__generate_embedding_before_insert
	BEFORE INSERT
	ON mooc.courses
	FOR EACH ROW
EXECUTE FUNCTION generate_embedding();
