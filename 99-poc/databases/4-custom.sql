CREATE SCHEMA mooc;

CREATE TABLE mooc.courses (
	id CHAR(4) PRIMARY KEY NOT NULL,
	name VARCHAR(255) NOT NULL,
	summary TEXT,
	categories jsonb NOT NULL,
	published_at DATE NOT NULL,
	embedding vector(768)
);

-- create index on mooc.courses using hnsw (embedding halfvec_cosine_ops);
