-- Schema for utility functions
create schema util;

-- Utility function to get the Supabase project URL (required for Edge Functions)
create or replace function util.project_url()
	returns text
	language plpgsql
security definer
as $$
declare
	secret_value text;
begin
	-- Retrieve the project URL from Vault
	-- 	select decrypted_secret into secret_value from vault.decrypted_secrets where name = 'project_url';
	-- 	return secret_value;
	return 'http://host.docker.internal:3000';
end;
$$;

-- Generic function to invoke any Edge Function
CREATE OR REPLACE FUNCTION util.invoke_edge_function(name text, body jsonb, timeout_milliseconds integer DEFAULT ((5 * 60) * 1000)) RETURNS void
	LANGUAGE plpgsql
AS
$$
declare
	headers_raw text;
	auth_header text;
	target_url text; -- Variable para almacenar la URL
begin
	-- If we're in a PostgREST session, reuse the request headers for authorization
	headers_raw := current_setting('request.headers', true);

	-- Only try to parse if headers are present
	auth_header := case
					   when headers_raw is not null then
						   (headers_raw::json->>'authorization')
					   else
						   null
		end;

	-- Construir la URL completa
	target_url := util.project_url() || '/functions/v1/' || name;

	-- Loguear la URL a donde se va a atacar
	raise warning 'Invoking edge function at URL: %', target_url;

	-- Perform async HTTP request to the edge function
	perform net.http_post(
			url => target_url, -- Usar la variable
			headers => jsonb_build_object(
					'Content-Type', 'application/json',
					'Authorization', auth_header
					   ),
			body => body,
			timeout_milliseconds => timeout_milliseconds
			);
end;
$$;

-- Generic trigger function to clear a column on update
create or replace function util.clear_column()
	returns trigger
language plpgsql as $$
declare
	clear_column text := TG_ARGV[0];
begin
	NEW := NEW #= hstore(clear_column, NULL);
	return NEW;
end;
$$;
