source ./_util.sh

util::execute_in_server pgai install -d "$POSTGRES_CONNECTION_STRING"
