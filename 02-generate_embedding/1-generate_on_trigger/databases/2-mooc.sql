CREATE SCHEMA mooc;

CREATE TABLE mooc.courses (
	id CHAR(4) PRIMARY KEY NOT NULL,
	name VARCHAR(255) NOT NULL,
	summary TEXT,
	published_at DATE NOT NULL,
	embedding vector(1536)
);
