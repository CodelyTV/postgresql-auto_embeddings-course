import { CourseEmbeddingGenerator } from "../../../../../../src/contexts/mooc/courses/application/generate-embedding/CourseEmbeddingGenerator";
import { CourseDoesNotExistError } from "../../../../../../src/contexts/mooc/courses/domain/CourseDoesNotExistError";
import { DomainCourseFinder } from "../../../../../../src/contexts/mooc/courses/domain/DomainCourseFinder";
import { EmbeddingMother } from "../../../../shared/domain/EmbeddingMother";
import { MockEmbeddingGenerator } from "../../../../shared/domain/MockEmbeddingGenerator";
import { CourseIdMother } from "../../domain/CourseIdMother";
import { CourseMother } from "../../domain/CourseMother";
import { MockCourseRepository } from "../../domain/MockCourseRepository";

describe("CourseEmbeddingGenerator should", () => {
	const repository = new MockCourseRepository();
	const embeddingGenerator = new MockEmbeddingGenerator();
	const finder = new DomainCourseFinder(repository);
	const courseEmbeddingGenerator = new CourseEmbeddingGenerator(
		finder,
		repository,
		embeddingGenerator,
	);

	it("throws an error generating embedding for a non existing course", async () => {
		const nonExistingCourseId = CourseIdMother.create();

		repository.shouldSearchAndReturnNull(nonExistingCourseId);

		await expect(async () => {
			await courseEmbeddingGenerator.generate(nonExistingCourseId.value);
		}).rejects.toThrow(
			new CourseDoesNotExistError(nonExistingCourseId.value),
		);
	});

	it("generate embedding for an existing course", async () => {
		const existingCourse = CourseMother.create();
		const existingCoursePrimitives = existingCourse.toPrimitives();
		const embeddingText = existingCourse.embeddingText();

		const embedding = EmbeddingMother.create(embeddingText);

		const courseWithEmbedding = CourseMother.create({
			...existingCoursePrimitives,
			embedding: embedding.output,
		});

		repository.shouldSearch(existingCourse);
		embeddingGenerator.shouldGenerate(embeddingText, embedding);
		repository.shouldSave(courseWithEmbedding);

		await courseEmbeddingGenerator.generate(existingCoursePrimitives.id);
	});
});
