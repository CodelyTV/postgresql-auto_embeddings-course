CREATE SCHEMA mooc;

CREATE TABLE mooc.courses (
	id CHAR(4) PRIMARY KEY NOT NULL,
	name VARCHAR(255) NOT NULL,
	summary TEXT,
	categories jsonb NOT NULL,
	published_at DATE NOT NULL,
	embedding vector(1536)
);

create or replace function embedding_input(doc mooc.courses)
	returns text
	language plpgsql
	immutable
as $$
begin
	return '# ' || doc.name || E'\n\n' || doc.summary;
end;
$$;

create trigger embed_course_on_insert
	after insert
	on mooc.courses
	for each row
execute function util.queue_embeddings('embedding_input', 'embedding');

create trigger embed_course_on_update
	after update of name, summary
	on mooc.courses
	for each row
execute function util.queue_embeddings('embedding_input', 'embedding');
