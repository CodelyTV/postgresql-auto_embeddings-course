CREATE OR REPLACE FUNCTION generate_course_embedding()
	RETURNS TRIGGER AS $$
BEGIN
	IF TG_OP = 'INSERT' OR (NEW.name IS DISTINCT FROM OLD.name OR NEW.summary IS DISTINCT FROM OLD.summary) THEN
		PERFORM net.http_post(
			url := 'http://host.docker.internal:3000/api/embeddings',
			body := JSONB_BUILD_OBJECT(
				'entity', 'course',
				'id', NEW.id
					),
			headers := JSONB_BUILD_OBJECT('Content-Type', 'application/json')
				);
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
