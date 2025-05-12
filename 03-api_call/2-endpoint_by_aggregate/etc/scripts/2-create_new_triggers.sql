CREATE OR REPLACE FUNCTION generate_course_embedding()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM net.http_post(
    url := 'http://host.docker.internal:3000/api/embeddings',
    body := JSONB_BUILD_OBJECT(
      'entity', 'course',
      'id', NEW.id
    ),
    headers := JSONB_BUILD_OBJECT('Content-Type', 'application/json')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg__courses__generate_embedding_after_insert
	AFTER INSERT ON mooc.courses
	FOR EACH ROW
EXECUTE FUNCTION generate_course_embedding();

CREATE OR REPLACE TRIGGER trg__courses__generate_embedding_after_update
	AFTER UPDATE OF name, summary ON mooc.courses
	FOR EACH ROW
EXECUTE FUNCTION generate_course_embedding();
