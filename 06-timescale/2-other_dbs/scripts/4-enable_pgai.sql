SELECT ai.create_vectorizer(
	'mooc.courses'::regclass,
	loading => ai.loading_column('summary'),
	embedding =>  ai.embedding_ollama(
		'nomic-embed-text',
		768,
		base_url => 'http://localhost:11434'
	),
	chunking => ai.chunking_none(),
	formatting => ai.formatting_python_template('# Name: $name | Summary: $chunk'),
	destination => ai.destination_column('embedding')
);

-- SELECT ai.drop_vectorizer('mooc_courses_embedding');
