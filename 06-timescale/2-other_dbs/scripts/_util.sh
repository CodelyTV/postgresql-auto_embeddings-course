util::execute_in_server() {
	docker exec -it 1-auto_embeddings_pgai-server-1 "${@}"
}
