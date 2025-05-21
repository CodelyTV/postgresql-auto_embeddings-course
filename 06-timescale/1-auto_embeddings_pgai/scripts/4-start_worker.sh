source ./_util.sh

util::execute_in_server pgai vectorizer worker \
	-d postgresql://supabase_admin:c0d3ly7v@1-auto_embeddings_pgai-postgres-1:5432/postgres \
	--poll-interval 3
