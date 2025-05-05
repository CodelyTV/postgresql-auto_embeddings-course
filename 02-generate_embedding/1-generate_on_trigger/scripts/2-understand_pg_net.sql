SELECT net.http_post(
	url := 'http://1-generate_on_trigger-ollama-1:11434/api/embeddings',
	body := JSONB_BUILD_OBJECT(
		'model', 'nomic-embed-text',
		'prompt', 'Un curso muy guapo'
	),
	headers := JSONB_BUILD_OBJECT('Content-Type', 'application/json')
) AS request_id;

SELECT * FROM net._http_response WHERE id = 1;
