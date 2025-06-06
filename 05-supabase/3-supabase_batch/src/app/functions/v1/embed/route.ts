/* eslint-disable camelcase,check-file/folder-naming-convention,no-console,@typescript-eslint/no-unused-vars,no-await-in-loop,@typescript-eslint/no-unnecessary-condition,no-constant-condition */
import "reflect-metadata";

import fs from "fs/promises";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import os from "os";
import path from "path";
import postgres from "postgres";
import { Readable } from "stream";
import { z } from "zod";

import { withErrorHandling } from "../../../../contexts/shared/infrastructure/http/withErrorHandling";

import { EmbeddingGenerationError } from "./EmbeddingGenerationError";

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

const dbUrl = "postgresql://supabase_admin:c0d3ly7v@localhost:5432/postgres";

const sql = postgres(dbUrl);

const QUEUE_NAME = "embedding_jobs";
const EMBEDDING_MODEL = "text-embedding-3-small";

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

type RequestJob = z.infer<typeof jobSchema>;
type FailedJob = z.infer<typeof failedJobSchema>;

type Row = {
	id: string | number;
	content: unknown;
};

type Job = {
	originalJob: RequestJob;
	contentToEmbed: string;
};

interface BatchEmbeddingItem {
	custom_id: string;
	method: "POST";
	url: "/v1/embeddings";
	body: {
		input: string;
		model: string;
	};
}

interface BatchSuccessResponse {
	object: "embedding";
	embedding: number[];
	index: number;
}

interface BatchResponseBody {
	object: string;
	data: BatchSuccessResponse[];
	model: string;
	usage: OpenAI.CompletionUsage;
}

interface BatchResponseItem {
	custom_id: string;
	response?: {
		status_code: number;
		request_id: string;
		body: BatchResponseBody;
	};
	error?: {
		code: string;
		message: string;
	};
}

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

async function searchJobTextContentToGenerateEmbedding(
	job: RequestJob,
): Promise<string> {
	const { id, schema, table, contentFunction } = job;
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
		console.error(`Error fetching content for job ${job.jobId}:`, error);
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
			`Invalid or empty content received from ${contentFunction} for ${schema}.${table}/${id}. Expected non-empty string, got: ${typeof row.content}, value: "${row.content}"`,
		);
	}

	return row.content.trim();
}

async function updateEmbeddingInDb(
	job: RequestJob,
	embedding: number[],
): Promise<void> {
	const { id, schema, table, embeddingColumn } = job;
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
				`Job ${job.jobId}: Row ${schema}.${table}/${id} not found during UPDATE (maybe deleted?).`,
			);
			throw new Error(
				`Row ${schema}.${table}/${id} disappeared before update.`,
			);
		}
	} catch (error) {
		console.error(`Error updating table for job ${job.jobId}:`, error);
		throw new Error(
			`Database error updating embedding: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function deleteJobFromQueue(jobId: number): Promise<void> {
	try {
		await sql`
      SELECT pgmq.delete(${QUEUE_NAME}, ARRAY[${jobId}::bigint])
    `;
		console.log(`> Job ${jobId} deleted from queue ${QUEUE_NAME}.`);
	} catch (error) {
		console.error(
			`Error deleting job ${jobId} from queue ${QUEUE_NAME}:`,
			error,
		);
		console.warn(
			`Failed to delete job ${jobId} from PGMQ. Please check manually. Error: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function extractJobsFromRequest(request: Request): Promise<RequestJob[]> {
	const rawBody = await request.json();
	const parseResult = z.array(jobSchema).safeParse(rawBody);

	if (!parseResult.success) {
		console.error("Invalid request body:", parseResult.error.issues);

		throw new EmbeddingGenerationError(
			`Invalid request body: ${parseResult.error.message}`,
		);
	}

	return parseResult.data;
}

async function waitUntilBatchIsCompleted(
	pendingBatchId: string,
): Promise<string> {
	while (true) {
		const currentBatch = await openai.batches.retrieve(pendingBatchId);
		console.log(
			`> Batch job ${currentBatch.id} status: ${currentBatch.status}`,
		);

		if (currentBatch.status === "completed") {
			if (!currentBatch.output_file_id) {
				throw new EmbeddingGenerationError(
					`> Batch job ${currentBatch.id} completed but no output file ID found.`,
				);
			}

			return currentBatch.output_file_id;
		}

		await sleep(2000);
	}
}

async function createOpenAIBatchRequest(job: Job[]): Promise<string> {
	const embeddingBodies: BatchEmbeddingItem[] = job.map((richJob) => ({
		custom_id: richJob.originalJob.jobId.toString(),
		method: "POST",
		url: "/v1/embeddings",
		body: {
			input: richJob.contentToEmbed,
			model: EMBEDDING_MODEL,
		},
	}));

	const jsonlData = embeddingBodies
		.map((req) => JSON.stringify(req))
		.join("\\n");

	let openaiFileId: string | undefined;
	const tempDir = os.tmpdir();
	const tempFilePath = path.join(
		tempDir,
		`embedding-batch-${Date.now()}.jsonl`,
	);

	try {
		await fs.writeFile(tempFilePath, jsonlData);
		const fileHandle = await fs.open(tempFilePath, "r");
		const readableStream = Readable.from(fileHandle.createReadStream());

		const fileUploadResponse = await openai.files.create({
			file: await OpenAI.toFile(
				readableStream,
				path.basename(tempFilePath),
			),
			purpose: "batch",
		});
		openaiFileId = fileUploadResponse.id;
		console.log(
			`> JSONL file uploaded to OpenAI. File ID: ${openaiFileId}`,
		);
		await fileHandle.close();
	} catch (error) {
		throw new EmbeddingGenerationError(
			`> Failed to submit batch to OpenAI: ${error instanceof Error ? error.message : "File upload error"}`,
		);
	} finally {
		if (tempFilePath) {
			await fs.unlink(tempFilePath);
		}
	}

	if (!openaiFileId) {
		throw new EmbeddingGenerationError(
			"OpenAI File ID not obtained, cannot create batch.",
		);
	}

	const batchJob = await openai.batches.create({
		input_file_id: openaiFileId,
		endpoint: "/v1/embeddings",
		completion_window: "24h",
	});
	console.log(
		`> Batch job created with OpenAI. Batch ID: ${batchJob.id}, Status: ${batchJob.status}`,
	);

	return batchJob.id;
}

async function addContentToJobs(jobsToProcess: RequestJob[]): Promise<{
	jobsWithContentToProcess: Job[];
	failedJobs: FailedJob[];
}> {
	const jobsWithContentToProcess: Job[] = [];
	const failedJobs: FailedJob[] = [];

	for (const job of jobsToProcess) {
		try {
			const content = await searchJobTextContentToGenerateEmbedding(job);
			jobsWithContentToProcess.push({
				originalJob: job,
				contentToEmbed: content,
			});
		} catch (error) {
			console.error(
				`Failed to fetch content for job ${job.jobId}:`,
				error,
			);
			failedJobs.push({
				...job,
				error:
					error instanceof Error
						? error.message
						: "Failed to fetch content",
			});
		}
	}

	return { jobsWithContentToProcess, failedJobs };
}

export const POST = withErrorHandling(async function (
	request: Request,
): Promise<NextResponse> {
	if (request.headers.get("content-type") !== "application/json") {
		return new NextResponse("Expected json body", { status: 400 });
	}

	const jobsToProcess: RequestJob[] = await extractJobsFromRequest(request);

	console.log(`Received ${jobsToProcess.length} jobs to process`);
	console.log("> Adding content for jobs");
	const { jobsWithContentToProcess, failedJobs } =
		await addContentToJobs(jobsToProcess);

	const pendingBatchId = await createOpenAIBatchRequest(
		jobsWithContentToProcess,
	);

	console.log(`> Polling batch job ${pendingBatchId} status...`);
	const completedBatchFileId =
		await waitUntilBatchIsCompleted(pendingBatchId);

	if (!completedBatchFileId) {
		throw new EmbeddingGenerationError(
			`> Batch job ${pendingBatchId} completed but no output file ID found.`,
		);
	}
	console.log(
		`> Batch job ${pendingBatchId} completed. Output file Id: ${completedBatchFileId}. Downloading results...`,
	);

	const completedJobs: RequestJob[] = [];
	const resultFileContent = await openai.files.content(completedBatchFileId);
	const resultsText = await resultFileContent.text();
	const resultLines = resultsText
		.trim()
		.split("\\n")
		.filter((line) => line.trim() !== "");

	const resultMap = new Map<string, Job>(
		jobsWithContentToProcess.map((rj) => [
			rj.originalJob.jobId.toString(),
			rj,
		]),
	);

	for (const line of resultLines) {
		const itemResult = JSON.parse(line) as BatchResponseItem;
		const richJob = resultMap.get(itemResult.custom_id) as Job;

		const originalJobDetails = richJob.originalJob;

		if (
			itemResult.error ||
			!itemResult.response ||
			itemResult.response.status_code !== 200
		) {
			failedJobs.push({
				...originalJobDetails,
				error: `OpenAI Batch Error`,
			});
		} else {
			const embeddingData = itemResult.response.body.data[0];
			await updateEmbeddingInDb(
				originalJobDetails,
				embeddingData.embedding,
			);
			await deleteJobFromQueue(originalJobDetails.jobId);
			completedJobs.push(originalJobDetails);
			console.log(
				`Successfully processed and stored embedding for job ${originalJobDetails.jobId}.`,
			);
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
