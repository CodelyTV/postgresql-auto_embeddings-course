/* eslint-disable camelcase,check-file/folder-naming-convention,no-console,@typescript-eslint/no-unused-vars,no-await-in-loop */
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

type Job = z.infer<typeof jobSchema>;
type FailedJob = z.infer<typeof failedJobSchema>;

type Row = {
	id: string | number;
	content: unknown;
};

type RichJob = {
	originalJob: Job;
	contentToEmbed: string;
};

interface BatchRequestItem {
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

async function fetchContentForJob(job: Job): Promise<string> {
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
	job: Job,
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
		console.log(`Job ${jobId} deleted from queue ${QUEUE_NAME}.`);
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

export const POST = withErrorHandling(async function (
	request: Request,
): Promise<NextResponse> {
	if (request.headers.get("content-type") !== "application/json") {
		return new NextResponse("Expected json body", { status: 400 });
	}

	let pendingJobs: Job[];
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
	const jobsForBatch: RichJob[] = [];

	console.log("Fetching content for jobs...");
	for (const job of pendingJobs) {
		try {
			const content = await fetchContentForJob(job);
			jobsForBatch.push({ originalJob: job, contentToEmbed: content });
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

	if (jobsForBatch.length === 0) {
		console.log(
			"No jobs eligible for batch processing after content fetching.",
		);

		return NextResponse.json(
			{
				completedJobIds: [],
				failedJobDetails: failedJobs,
			},
			{ status: 200 },
		);
	}

	console.log(`${jobsForBatch.length} jobs prepared for batch embedding.`);

	const batchRequests: BatchRequestItem[] = jobsForBatch.map((richJob) => ({
		custom_id: richJob.originalJob.jobId.toString(),
		method: "POST",
		url: "/v1/embeddings",
		body: {
			input: richJob.contentToEmbed,
			model: EMBEDDING_MODEL,
		},
	}));

	const jsonlData = batchRequests
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
		console.log(`JSONL file uploaded to OpenAI. File ID: ${openaiFileId}`);
		await fileHandle.close();
	} catch (error) {
		console.error(
			"Failed to create or upload batch file to OpenAI:",
			error,
		);
		jobsForBatch.forEach((richJob) => {
			failedJobs.push({
				...richJob.originalJob,
				error: `Failed to submit batch to OpenAI: ${error instanceof Error ? error.message : "File upload error"}`,
			});
		});

		return NextResponse.json(
			{
				completedJobIds: completedJobs.map((j) => j.jobId),
				failedJobDetails: failedJobs,
			},
			{ status: 500 },
		);
	} finally {
		if (tempFilePath) {
			try {
				await fs.unlink(tempFilePath);
			} catch (unlinkError) {
				console.warn(
					`Failed to delete temporary file ${tempFilePath}:`,
					unlinkError,
				);
			}
		}
	}

	if (!openaiFileId) {
		console.error("OpenAI File ID not obtained, cannot create batch.");

		return NextResponse.json(
			{ completedJobIds: [], failedJobDetails: failedJobs },
			{ status: 500 },
		);
	}

	let batchJob: OpenAI.Batches.Batch;
	try {
		batchJob = await openai.batches.create({
			input_file_id: openaiFileId,
			endpoint: "/v1/embeddings",
			completion_window: "24h",
		});
		console.log(
			`Batch job created with OpenAI. Batch ID: ${batchJob.id}, Status: ${batchJob.status}`,
		);
	} catch (error) {
		console.error("Failed to create batch job with OpenAI:", error);
		jobsForBatch.forEach((richJob) => {
			failedJobs.push({
				...richJob.originalJob,
				error: `Failed to create OpenAI batch job: ${error instanceof Error ? error.message : "Batch creation error"}`,
			});
		});

		return NextResponse.json(
			{
				completedJobIds: completedJobs.map((j) => j.jobId),
				failedJobDetails: failedJobs,
			},
			{ status: 500 },
		);
	}

	console.log(`Polling batch job ${batchJob.id} status...`);
	try {
		while (true) {
			batchJob = await openai.batches.retrieve(batchJob.id);
			console.log(`Batch job ${batchJob.id} status: ${batchJob.status}`);

			if (
				batchJob.status === "completed" ||
				batchJob.status === "failed" ||
				batchJob.status === "cancelled"
			) {
				break;
			}
			await sleep(2000);
		}
	} catch (error) {
		console.error(`Error polling batch job ${batchJob.id}:`, error);
		jobsForBatch.forEach((richJob) => {
			failedJobs.push({
				...richJob.originalJob,
				error: `Failed while polling batch job: ${error instanceof Error ? error.message : "Polling error"}`,
			});
		});

		return NextResponse.json(
			{
				completedJobIds: completedJobs.map((j) => j.jobId),
				failedJobDetails: failedJobs,
			},
			{ status: 500 },
		);
	}

	if (batchJob.status === "completed") {
		if (!batchJob.output_file_id) {
			console.error(
				`Batch job ${batchJob.id} completed but no output file ID found.`,
			);
			jobsForBatch.forEach((richJob) => {
				failedJobs.push({
					...richJob.originalJob,
					error: "OpenAI batch completed but no output file ID was provided.",
				});
			});
		} else {
			console.log(
				`Batch job ${batchJob.id} completed. Output file ID: ${batchJob.output_file_id}. Downloading results...`,
			);
			try {
				const resultFileContent = await openai.files.content(
					batchJob.output_file_id,
				);
				const resultsText = await resultFileContent.text();
				const resultLines = resultsText
					.trim()
					.split("\\n")
					.filter((line) => line.trim() !== "");

				const resultMap = new Map<string, RichJob>(
					jobsForBatch.map((rj) => [
						rj.originalJob.jobId.toString(),
						rj,
					]),
				);

				for (const line of resultLines) {
					const itemResult = JSON.parse(line) as BatchResponseItem;
					const richJob = resultMap.get(itemResult.custom_id);

					if (!richJob) {
						console.warn(
							`Received result for unknown custom_id: ${itemResult.custom_id}`,
						);
						continue;
					}

					const originalJobDetails = richJob.originalJob;

					if (
						itemResult.error ||
						!itemResult.response ||
						itemResult.response.status_code !== 200
					) {
						const errorMessage =
							itemResult.error?.message ??
							`OpenAI embedding failed with status ${itemResult.response?.status_code ?? "unknown"}`;
						console.error(
							`Embedding failed for job ${originalJobDetails.jobId} (custom_id: ${itemResult.custom_id}): ${errorMessage}`,
						);
						failedJobs.push({
							...originalJobDetails,
							error: `OpenAI Batch Error: ${errorMessage}`,
						});
					} else {
						const embeddingData = itemResult.response.body.data[0];
						if (embeddingData && embeddingData.embedding) {
							try {
								await updateEmbeddingInDb(
									originalJobDetails,
									embeddingData.embedding,
								);
								await deleteJobFromQueue(
									originalJobDetails.jobId,
								);
								completedJobs.push(originalJobDetails);
								console.log(
									`Successfully processed and stored embedding for job ${originalJobDetails.jobId}.`,
								);
							} catch (dbError) {
								console.error(
									`Failed to update DB or PGMQ for job ${originalJobDetails.jobId}:`,
									dbError,
								);
								failedJobs.push({
									...originalJobDetails,
									error: `DB/PGMQ update failed after embedding: ${dbError instanceof Error ? dbError.message : "Unknown DB error"}`,
								});
							}
						} else {
							console.error(
								`Embedding data missing in successful response for job ${originalJobDetails.jobId} (custom_id: ${itemResult.custom_id})`,
							);
							failedJobs.push({
								...originalJobDetails,
								error: "OpenAI Batch Error: Embedding data missing in successful response.",
							});
						}
					}
				}
			} catch (error) {
				console.error(
					`Failed to download or process batch results file ${batchJob.output_file_id}:`,
					error,
				);
				jobsForBatch.forEach((rj) => {
					if (
						!completedJobs.find(
							(cj) => cj.jobId === rj.originalJob.jobId,
						) &&
						!failedJobs.find(
							(fj) => fj.jobId === rj.originalJob.jobId,
						)
					) {
						failedJobs.push({
							...rj.originalJob,
							error: `Failed to process batch results: ${error instanceof Error ? error.message : "Result processing error"}`,
						});
					}
				});
			}
		}
	} else {
		console.error(
			`Batch job ${batchJob.id} finished with status: ${batchJob.status}. Errors: ${JSON.stringify(batchJob.errors)}`,
		);
		const batchErrorMsg = `OpenAI Batch ${batchJob.status}: ${batchJob.errors?.data?.[0]?.message ?? "Unknown batch error"}`;
		jobsForBatch.forEach((richJob) => {
			if (
				!completedJobs.find(
					(cj) => cj.jobId === richJob.originalJob.jobId,
				) &&
				!failedJobs.find((fj) => fj.jobId === richJob.originalJob.jobId)
			) {
				failedJobs.push({
					...richJob.originalJob,
					error: batchErrorMsg,
				});
			}
		});
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
