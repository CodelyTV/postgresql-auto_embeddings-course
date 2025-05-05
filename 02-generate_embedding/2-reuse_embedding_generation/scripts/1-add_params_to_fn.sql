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

CREATE TRIGGER trg__courses__generate_embedding_before_insert
	AFTER INSERT
	ON mooc.courses
	FOR EACH ROW
EXECUTE FUNCTION generate_embedding('mooc.generate_course_embedding_input');

CREATE TRIGGER trg__courses__generate_embedding_before_update
	AFTER UPDATE OF name, summary -- must match the columns in embedding_input()
	ON mooc.courses
	FOR EACH ROW
EXECUTE FUNCTION generate_embedding('mooc.generate_course_embedding_input');
