DO $$
	DECLARE
		-- Parámetros principales
		v_batch_size INT := 10;
		v_max_requests INT := 10;
		v_timeout_milliseconds INT := 5 * 60 * 1000; -- 5 minutos

		-- Variable para almacenar los batches leídos
		job_batches jsonb[];
	BEGIN
		-- Leer mensajes y agruparlos en batches
		WITH
			numbered_jobs AS (
				SELECT
					message || jsonb_build_object('jobId', msg_id) AS job_info,
					(row_number() OVER (ORDER BY msg_id) - 1) / v_batch_size AS batch_num
				FROM pgmq.read(
						queue_name => 'embedding_jobs',
						vt => v_timeout_milliseconds / 1000,
						qty => v_max_requests * v_batch_size
					 )
			),
			batched_jobs AS (
				SELECT
					jsonb_agg(job_info ORDER BY (job_info->>'jobId')::bigint) AS batch_array,
					batch_num
				FROM numbered_jobs
				GROUP BY batch_num
			)
		SELECT coalesce(array_agg(batch_array ORDER BY batch_num), ARRAY[]::jsonb[])
		FROM batched_jobs
		INTO job_batches;

		RAISE NOTICE 'Batches to process: %', job_batches;

		-- Bucle FOREACH para procesar cada batch
		DECLARE
			batch jsonb;             -- Variable para el batch actual del loop
			-- Variables necesarias para la lógica de invoke_edge_function
			v_headers_raw text;
			v_auth_header text;
			v_target_url text;
			v_function_name text := 'embed'; -- Nombre de la función a invocar
		BEGIN
			FOREACH batch IN ARRAY job_batches LOOP
					RAISE NOTICE 'Processing batch: %', batch;

					-- --- INICIO: Lógica inline de invoke_edge_function ---
					BEGIN
						-- Obtener cabeceras (si estamos en sesión PostgREST)
						v_headers_raw := current_setting('request.headers', true);

						-- Extraer cabecera de autorización
						v_auth_header := case
											 when v_headers_raw is not null then
												 (v_headers_raw::json->>'authorization')
											 else
												 null
							end;

						-- Construir URL de destino
						v_target_url := util.project_url() || '/functions/v1/' || v_function_name;
						RAISE NOTICE 'Target URL: %', v_target_url; -- Loguear URL

						-- Realizar la llamada HTTP POST
						perform net.http_post(
								url => v_target_url,
								headers => jsonb_build_object(
										'Content-Type', 'application/json',
										'Authorization', v_auth_header
										   ),
								body => batch, -- Usar el 'batch' del bucle FOREACH
								timeout_milliseconds => v_timeout_milliseconds -- Usar el timeout del bloque principal
								);
						RAISE NOTICE 'Successfully invoked edge function for batch.';
					EXCEPTION
						WHEN others THEN
							RAISE WARNING 'Error invoking edge function for batch: %. SQLSTATE: %, SQLERRM: %', batch, sqlstate, sqlerrm;
						-- Aquí podrías añadir lógica de manejo de error si la llamada falla
					END;
					-- --- FIN: Lógica inline de invoke_edge_function ---

				END LOOP;
		END;

	END $$;
