import { prisma } from "../../../lib/prisma";

const MAX_LIMIT = 100;

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const plate = (searchParams.get("search") ?? searchParams.get("plate"))
		?.trim()
		.toUpperCase();
	const sortBy = searchParams.get("sortBy") ?? "entryTime";
	const order = searchParams.get("order") ?? "desc";

	if (sortBy !== "entryTime" || !["asc", "desc"].includes(order)) {
		return Response.json(
			{ error: "Only entryTime sorting with asc or desc order is supported" },
			{ status: 400 },
		);
	}

	const requestedPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
	const requestedLimit = Number.parseInt(searchParams.get("limit") ?? "10", 10);
	const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
	const limit =
		Number.isInteger(requestedLimit) && requestedLimit > 0
			? Math.min(requestedLimit, MAX_LIMIT)
			: 10;
	const where = plate ? { plate: { contains: plate } } : {};

	const [tickets, total] = await prisma.$transaction([
		prisma.ticket.findMany({
			where,
			include: { spot: true },
			orderBy: { entryTime: order as "asc" | "desc" },
			skip: (page - 1) * limit,
			take: limit,
		}),
		prisma.ticket.count({ where }),
	]);

	return Response.json({
		tickets,
		total,
		pages: Math.ceil(total / limit),
	});
}
