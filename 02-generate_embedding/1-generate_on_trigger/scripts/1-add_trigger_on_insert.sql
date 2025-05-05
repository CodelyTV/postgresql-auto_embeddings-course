CREATE OR REPLACE FUNCTION generate_embedding(
) RETURNS trigger
	LANGUAGE plpgsql
AS
$$
BEGIN
	NEW.embedding = '[' || array_to_string(array_fill(0::double precision, ARRAY[768]), ',') || ']';
	RETURN NEW;
END;
$$;

CREATE TRIGGER trg__courses__generate_embedding_before_insert
	BEFORE INSERT
	ON mooc.courses
	FOR EACH ROW
EXECUTE FUNCTION generate_embedding();
