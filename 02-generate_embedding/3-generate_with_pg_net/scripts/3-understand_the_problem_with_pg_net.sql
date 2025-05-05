SELECT * FROM net._http_response WHERE id = (
	SELECT net.http_post(
		url := 'http://3-generate_with_pg_net-ollama-1:11434/api/embeddings',
		body := JSONB_BUILD_OBJECT(
			'model', 'nomic-embed-text',
			'prompt', 'Un curso muy guapo'
		),
		headers := JSONB_BUILD_OBJECT('Content-Type', 'application/json')
	)
);
