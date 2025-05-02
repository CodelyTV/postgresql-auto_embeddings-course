/* eslint-disable camelcase,check-file/folder-naming-convention,no-console,@typescript-eslint/no-unused-vars */
import "reflect-metadata";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import postgres from "postgres";
import { z } from "zod";

import { executeWithErrorHandling } from "../../../../contexts/shared/infrastructure/http/executeWithErrorHandling";

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

const dbUrl = "postgresql://supabase_admin:c0d3ly7v@localhost:5432/postgres";

const sql = postgres(dbUrl);

const QUEUE_NAME = "embedding_jobs";

const jobSchema = z.object({
	jobId: z.number(),
	id: z.union([z.number(), z.string()]),
	schema: z.string(),
	table: z.string(),
	contentFunction: z.string(),
	embeddingColumn: z.string(),
});

const failedJobSchema = jobSchema.extend({
	error: z.string(),
});

type Job = z.infer<typeof jobSchema>;
type FailedJob = z.infer<typeof failedJobSchema>;

type Row = {
	id: string | number;
	content: unknown;
};

async function generateEmbedding(text: string): Promise<number[]> {
	if (!text || text.trim().length === 0) {
		console.warn(
			"generateEmbedding called with empty or whitespace-only text.",
		);
		throw new Error("Cannot generate embedding for empty content.");
	}

	try {
		const response = await openai.embeddings.create({
			model: "text-embedding-3-small",
			input: text.trim(),
		});
		const [data] = response.data;

		if (!data.embedding) {
			throw new Error(
				"Failed to generate embedding - No data returned from OpenAI.",
			);
		}

		return data.embedding;
	} catch (error) {
		console.error("Error calling OpenAI API:", error);
		// Re-lanzar el error para que sea capturado por el llamador (processJob)
		throw new Error(
			`Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function processJob(job: Job): Promise<void> {
	const { jobId, id, schema, table, contentFunction, embeddingColumn } = job;
	console.log(`Processing job ${jobId} for ${schema}.${table}/${id}`);

	let rows: Row[];
	try {
		// ¡IMPORTANTE! Usa sql`` para prevenir inyección SQL con nombres de tablas/schemas/funciones
		// `sql(schema)`, `sql(table)`, `sql(contentFunction)` y `sql(embeddingColumn)` son correctos.
		// `id` y `jobId` se pasan como valores, postgres.js los manejará de forma segura.
		rows = await sql<Row[]>`
      SELECT
        t.id,
        ${sql(contentFunction)}(t) as content
      FROM
        ${sql(schema)}.${sql(table)} AS t
      WHERE
        t.id = ${id}
    `;
	} catch (error) {
		console.error(`Error fetching content for job ${jobId}:`, error);
		throw new Error(
			`Database error fetching content: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const [row] = rows;

	if (!row) {
		// Considera si esto es un error recuperable o no. Podría ser que el registro se eliminó.
		// Lanzar un error aquí lo marcará como 'failedJob'. Podrías querer solo loguearlo y completar el job.
		throw new Error(`Row not found: ${schema}.${table}/${id}`);
	}

	// Validar que el contenido es un string no vacío
	if (typeof row.content !== "string" || row.content.trim().length === 0) {
		throw new Error(
			`Invalid or empty content received from ${contentFunction} for ${schema}.${table}/${id}. Expected non-empty string, got: ${typeof row.content}`,
		);
	}

	// Generar el embedding (ya maneja errores internos)
	const embedding = await generateEmbedding(row.content);

	try {
		// Actualizar la fila con el embedding
		const result = await sql`
      UPDATE ${sql(schema)}.${sql(table)}
      SET
        ${sql(embeddingColumn)} = ${JSON.stringify(embedding)}::vector -- Asegúrate que el tipo es correcto (ej: ::vector)
      WHERE
        id = ${id}
    `;

		// Comprobar si la actualización afectó a alguna fila
		if (result.count === 0) {
			// Esto podría ocurrir si la fila se eliminó entre el SELECT y el UPDATE (condición de carrera)
			console.warn(
				`Job ${jobId}: Row ${schema}.${table}/${id} not found during UPDATE (maybe deleted?).`,
			);
			// Decide si esto es un fallo del job o no. Marcándolo como error podría ser lo más seguro.
			throw new Error(
				`Row ${schema}.${table}/${id} disappeared before update.`,
			);
		}
	} catch (error) {
		console.error(`Error updating table for job ${jobId}:`, error);
		throw new Error(
			`Database error updating embedding: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	try {
		// Eliminar el job de la cola PGMQ
		await sql`
      SELECT pgmq.delete(${QUEUE_NAME}, ARRAY[${jobId}::bigint]) -- Convertir jobId a bigint para PGMQ
    `;
		console.log(`Job ${jobId} deleted from queue ${QUEUE_NAME}.`);
	} catch (error) {
		console.error(
			`Error deleting job ${jobId} from queue ${QUEUE_NAME}:`,
			error,
		);
		// Este error es problemático porque el trabajo se hizo, pero podría reintentarse.
		// Podrías querer loguearlo de forma especial o tener un mecanismo de limpieza.
		// Por ahora, lo lanzamos para que el job se marque como fallido aunque el embedding se haya guardado.
		throw new Error(
			`Database error deleting job from PGMQ: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

// --- Handler de la API Route ---

export async function POST(request: Request): Promise<NextResponse> {
	// executeWithErrorHandling ya proporciona un try/catch general
	return executeWithErrorHandling(async () => {
		let pendingJobs: Job[];

		// 1. Validar Content-Type
		if (request.headers.get("content-type") !== "application/json") {
			// Usar HttpNextResponse para respuestas estandarizadas si existe, sino NextResponse
			// return HttpNextResponse.badRequest("Expected json body");
			return new NextResponse("Expected json body", { status: 400 });
		}

		// 2. Parsear y Validar el Body
		try {
			const rawBody = await request.json();
			const parseResult = z.array(jobSchema).safeParse(rawBody);

			if (!parseResult.success) {
				console.error(
					"Invalid request body:",
					parseResult.error.issues,
				);

				// return HttpNextResponse.badRequest(`Invalid request body: ${parseResult.error.message}`);
				return new NextResponse(
					`Invalid request body: ${parseResult.error.message}`,
					{ status: 400 },
				);
			}
			pendingJobs = parseResult.data;
			console.log(`Received ${pendingJobs.length} jobs to process.`);
		} catch (error) {
			console.error("Error parsing request body:", error);

			// return HttpNextResponse.badRequest("Invalid JSON format");
			return new NextResponse("Invalid JSON format", { status: 400 });
		}

		// 3. Procesar los Jobs
		const completedJobs: Job[] = [];
		const failedJobs: FailedJob[] = [];

		// Procesar jobs secuencialmente (uno tras otro)
		for (const job of pendingJobs) {
			try {
				await processJob(job);
				completedJobs.push(job);
			} catch (error) {
				console.error(`Failed to process job ${job.jobId}:`, error);
				failedJobs.push({
					...job,
					error:
						error instanceof Error
							? error.message
							: JSON.stringify(error),
				});
			}
		}

		// 4. Loguear Resultados y Responder
		console.log(
			`Finished processing jobs: ${completedJobs.length} completed, ${failedJobs.length} failed.`,
		);

		// Devolver un resumen, similar a la función Deno original
		return NextResponse.json(
			{
				// Podríamos devolver solo los IDs o la lista completa
				completedJobIds: completedJobs.map((j) => j.jobId),
				failedJobDetails: failedJobs, // Devolver detalles de los fallidos puede ser útil
			},
			{
				status: 200, // OK, incluso si algunos jobs fallaron (la operación del batch terminó)
				headers: {
					// Headers personalizados opcionales si son útiles para el cliente
					"X-Completed-Jobs": completedJobs.length.toString(),
					"X-Failed-Jobs": failedJobs.length.toString(),
				},
			},
		);

		// Ya no necesitamos retornar NoContent
		// return HttpNextResponse.noContent();
	});
}

// Nota: La lógica de `catchUnload` de Deno no se aplica directamente aquí.
// Next.js (especialmente en Vercel) tiene sus propios límites de tiempo de ejecución.
// `executeWithErrorHandling` debería encargarse de errores inesperados o timeouts.
// El procesamiento secuencial actual manejará los jobs uno por uno hasta que terminen o falle la función.
