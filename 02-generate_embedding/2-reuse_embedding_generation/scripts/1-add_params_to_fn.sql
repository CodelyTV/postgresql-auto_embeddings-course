CREATE OR REPLACE FUNCTION mooc.generate_course_embedding_input(
	course mooc.courses
)
	RETURNS TEXT
	LANGUAGE plpgsql
	IMMUTABLE
AS
$$
BEGIN
	RETURN '# ' || course.name || E'\n\n' || course.summary; -- La E significa que contiene secuencia de escape
END;
$$;

CREATE OR REPLACE TRIGGER trg__courses__generate_embedding_before_insert
	BEFORE INSERT
	ON mooc.courses
	FOR EACH ROW
EXECUTE FUNCTION generate_embedding('mooc.generate_course_embedding_input');

CREATE OR REPLACE TRIGGER trg__courses__generate_embedding_before_update
	BEFORE UPDATE OF name, summary
	ON mooc.courses
	FOR EACH ROW
EXECUTE FUNCTION generate_embedding('mooc.generate_course_embedding_input');

CREATE OR REPLACE FUNCTION generate_embedding(
)
	RETURNS TRIGGER
	LANGUAGE plpgsql
AS
$$
DECLARE
	embedding_input_func_name TEXT  = TG_ARGV[0];
	text_content TEXT;
	response_body jsonb;
	embedding_array DOUBLE PRECISION[];
	api_url TEXT := 'http://2-reuse_embedding_generation-ollama-1:11434/api/embeddings';
	query_string TEXT;
BEGIN
	query_string := 'SELECT ' || embedding_input_func_name || '($1)';
	EXECUTE query_string INTO text_content USING new;

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
