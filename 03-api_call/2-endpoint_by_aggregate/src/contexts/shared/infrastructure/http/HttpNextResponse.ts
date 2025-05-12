import { NextResponse } from "next/server";

import { DomainError } from "../../domain/DomainError";

export class HttpNextResponse {
	static domainError(error: DomainError, statusCode: number): NextResponse {
		return NextResponse.json(
			{
				error: error.toPrimitives(),
			},
			{ status: statusCode },
		);
	}

	static badRequest(message: string): NextResponse {
		return NextResponse.json(
			{
				error: {
					type: "InvalidRequest",
					description: message,
					data: {},
				},
			},
			{ status: 400 },
		);
	}

	static notFound(message: string): NextResponse {
		return NextResponse.json(
			{
				error: {
					type: "NotFound",
					description: message,
					data: {},
				},
			},
			{ status: 404 },
		);
	}

	static internalServerError(): NextResponse {
		return NextResponse.json(
			{
				code: "InternalServerError",
				message: "Internal server error",
				data: {},
			},
			{ status: 500 },
		);
	}

	static created(): NextResponse {
		return new NextResponse(null, { status: 201 });
	}

	static noContent(): NextResponse {
		return new NextResponse(null, { status: 204 });
	}

	static json<JsonBody>(data: JsonBody): NextResponse {
		return NextResponse.json(data, { status: 200 });
	}

	static ok(): NextResponse {
		return new NextResponse(null, { status: 200 });
	}
}
