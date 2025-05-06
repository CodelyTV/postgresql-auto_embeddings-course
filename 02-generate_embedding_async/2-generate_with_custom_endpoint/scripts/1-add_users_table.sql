CREATE TABLE mooc.users (
	id CHAR(4) PRIMARY KEY NOT NULL,
	name TEXT NOT NULL,
	bio TEXT NOT NULL,
	email TEXT NOT NULL UNIQUE,
	embedding vector(768),
	request_id BIGINT
);

CREATE OR REPLACE FUNCTION mooc.users__generate_embedding_input(
	u mooc.users
)
	RETURNS TEXT
	LANGUAGE plpgsql
	IMMUTABLE
AS
$$
BEGIN
	RETURN '# ' || u.name || E'\n\n' || u.bio;
END;
$$;

CREATE OR REPLACE TRIGGER trg__users__generate_embedding_before_insert
	BEFORE INSERT
	ON mooc.users
	FOR EACH ROW
EXECUTE FUNCTION generate_embedding('mooc.users__generate_embedding_input');

CREATE OR REPLACE TRIGGER trg__users__generate_embedding_before_update
	BEFORE UPDATE OF name, bio
	ON mooc.users
	FOR EACH ROW
EXECUTE FUNCTION generate_embedding('mooc.users__generate_embedding_input');
