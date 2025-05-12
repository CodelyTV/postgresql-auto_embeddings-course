DROP TABLE net.embedding_requests;

DROP TRIGGER trg__http_response__handle_embedding_response_after_insert ON net._http_response;
DROP FUNCTION net._http_response__handle_embedding_response;

ALTER TABLE mooc.courses DROP COLUMN request_id;
ALTER TABLE mooc.users DROP COLUMN request_id;

DROP TRIGGER trg__courses__generate_embedding_before_insert on mooc.courses;
DROP TRIGGER trg__courses__generate_embedding_before_update on mooc.courses;
DROP TRIGGER trg__users__generate_embedding_before_insert on mooc.users;
DROP TRIGGER trg__users__generate_embedding_before_update on mooc.users;
DROP FUNCTION generate_embedding;
