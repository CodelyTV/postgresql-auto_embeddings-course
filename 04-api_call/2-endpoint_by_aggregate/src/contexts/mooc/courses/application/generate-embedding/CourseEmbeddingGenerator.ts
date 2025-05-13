import { Service } from "diod";

import { EmbeddingGenerator } from "../../../../shared/domain/EmbeddingGenerator";
import { CourseRepository } from "../../domain/CourseRepository";
import { DomainCourseFinder } from "../../domain/DomainCourseFinder";

@Service()
export class CourseEmbeddingGenerator {
	constructor(
		private readonly finder: DomainCourseFinder,
		private readonly repository: CourseRepository,
		private readonly embeddingGenerator: EmbeddingGenerator,
	) {}

	async generate(id: string): Promise<void> {
		const course = await this.finder.find(id);

		const embeddings = await this.embeddingGenerator.generate(
			course.embeddingText(),
		);

		course.updateEmbedding(embeddings.output);

		await this.repository.save(course);
	}
}
