/* eslint-disable camelcase,check-file/folder-naming-convention,no-console,@typescript-eslint/no-unused-vars,no-await-in-loop */
import "reflect-metadata";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import postgres from "postgres";
import { z } from "zod";

import { withErrorHandling } from "../../../../contexts/shared/infrastructure/http/withErrorHandling";

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
		throw new Error(`Row not found: ${schema}.${table}/${id}`);
	}

	if (typeof row.content !== "string" || row.content.trim().length === 0) {
		throw new Error(
			`Invalid or empty content received from ${contentFunction} for ${schema}.${table}/${id}. Expected non-empty string, got: ${typeof row.content}`,
		);
	}

	const embedding = await generateEmbedding(row.content);

	try {
		const result = await sql`
      UPDATE ${sql(schema)}.${sql(table)}
      SET
        ${sql(embeddingColumn)} = ${JSON.stringify(embedding)}::vector
      WHERE
        id = ${id}
    `;

		if (result.count === 0) {
			console.warn(
				`Job ${jobId}: Row ${schema}.${table}/${id} not found during UPDATE (maybe deleted?).`,
			);
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
		await sql`
      SELECT pgmq.delete(${QUEUE_NAME}, ARRAY[${jobId}::bigint])
    `;
		console.log(`Job ${jobId} deleted from queue ${QUEUE_NAME}.`);
	} catch (error) {
		console.error(
			`Error deleting job ${jobId} from queue ${QUEUE_NAME}:`,
			error,
		);
		throw new Error(
			`Database error deleting job from PGMQ: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export const POST = withErrorHandling(async function (
	request: Request,
): Promise<NextResponse> {
	let pendingJobs: Job[];

	if (request.headers.get("content-type") !== "application/json") {
		return new NextResponse("Expected json body", { status: 400 });
	}

	try {
		const rawBody = await request.json();
		const parseResult = z.array(jobSchema).safeParse(rawBody);

		if (!parseResult.success) {
			console.error("Invalid request body:", parseResult.error.issues);

			return new NextResponse(
				`Invalid request body: ${parseResult.error.message}`,
				{ status: 400 },
			);
		}
		pendingJobs = parseResult.data;
		console.log(`Received ${pendingJobs.length} jobs to process.`);
	} catch (error) {
		console.error("Error parsing request body:", error);

		return new NextResponse("Invalid JSON format", { status: 400 });
	}

	const completedJobs: Job[] = [];
	const failedJobs: FailedJob[] = [];

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

	console.log(
		`Finished processing jobs: ${completedJobs.length} completed, ${failedJobs.length} failed.`,
	);

	return NextResponse.json(
		{
			completedJobIds: completedJobs.map((j) => j.jobId),
			failedJobDetails: failedJobs,
		},
		{
			status: 200,
			headers: {
				"X-Completed-Jobs": completedJobs.length.toString(),
				"X-Failed-Jobs": failedJobs.length.toString(),
			},
		},
	);
});
