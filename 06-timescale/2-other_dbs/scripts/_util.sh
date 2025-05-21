util::execute_in_server() {
	docker exec -it 2-other_dbs-server-1 "${@}"
}
