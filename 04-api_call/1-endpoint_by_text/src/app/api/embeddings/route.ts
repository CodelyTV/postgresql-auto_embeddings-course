/* eslint-disable camelcase */
import "reflect-metadata";

import { NextResponse } from "next/server";

import { EmbeddingGenerator } from "../../../contexts/shared/domain/EmbeddingGenerator";
import { container } from "../../../contexts/shared/infrastructure/dependency-injection/diod.config";
import { executeWithErrorHandling } from "../../../contexts/shared/infrastructure/http/executeWithErrorHandling";
import { HttpNextResponse } from "../../../contexts/shared/infrastructure/http/HttpNextResponse";

export async function POST(request: Request): Promise<NextResponse> {
	return executeWithErrorHandling(async () => {
		const generator = container.get(EmbeddingGenerator);

		const { input } = (await request.json()) as {
			input: string;
		};

		const embedding = await generator.generate(input);

		return HttpNextResponse.json({ embedding: embedding.output });
	});
}
