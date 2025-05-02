/* eslint-disable camelcase,check-file/folder-naming-convention,no-console */
import "reflect-metadata";

import { NextResponse } from "next/server";

import { executeWithErrorHandling } from "../../../contexts/shared/infrastructure/http/executeWithErrorHandling";
import { HttpNextResponse } from "../../../contexts/shared/infrastructure/http/HttpNextResponse";

export async function POST(
	_request: Request,
	{ params }: { params: Promise<unknown> },
): Promise<NextResponse> {
	return executeWithErrorHandling(async () => {
		console.log(params);

		return HttpNextResponse.noContent();
	});
}
