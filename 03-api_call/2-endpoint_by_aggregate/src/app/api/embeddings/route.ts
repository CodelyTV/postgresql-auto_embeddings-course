/* eslint-disable camelcase,@typescript-eslint/no-unnecessary-condition */
import "reflect-metadata";

import { NextResponse } from "next/server";

import { CourseEmbeddingGenerator } from "../../../contexts/mooc/courses/application/generate-embedding/CourseEmbeddingGenerator";
import { container } from "../../../contexts/shared/infrastructure/dependency-injection/diod.config";
import { executeWithErrorHandling } from "../../../contexts/shared/infrastructure/http/executeWithErrorHandling";
import { HttpNextResponse } from "../../../contexts/shared/infrastructure/http/HttpNextResponse";

type EmbeddingGenerator = { generate: (id: string) => Promise<void> };

export async function POST(request: Request): Promise<NextResponse> {
	return executeWithErrorHandling(async () => {
		const embeddingGenerators: Record<string, EmbeddingGenerator> = {
			course: container.get(CourseEmbeddingGenerator),
		};

		const { entity, id } = (await request.json()) as {
			entity: string;
			id: string;
		};

		const generator = embeddingGenerators[entity];

		if (!generator) {
			return HttpNextResponse.notFound(
				`Embedding generator for ${entity} not found.`,
			);
		}

		await generator.generate(id);

		return HttpNextResponse.created();
	});
}
