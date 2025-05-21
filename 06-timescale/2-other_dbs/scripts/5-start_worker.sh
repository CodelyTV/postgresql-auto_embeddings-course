source ./_util.sh

util::execute_in_server pgai vectorizer worker \
	-d "$POSTGRES_CONNECTION_STRING" \
	--poll-interval 3
