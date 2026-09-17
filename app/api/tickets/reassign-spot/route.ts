import { prisma } from "../../../../lib/prisma";

export async function POST(request: Request) {
	try {
		const body = await request.json();
		const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : "";
		const targetSpotId = typeof body.targetSpotId === "string" ? body.targetSpotId.trim() : "";
		if (!ticketId || !targetSpotId) return Response.json({ error: "ticketId and targetSpotId are required" }, { status: 400 });

		const result = await prisma.$transaction(async (tx) => {
			const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, include: { spot: true } });
			const target = await tx.spot.findUnique({ where: { id: targetSpotId } });
			if (!ticket || ticket.status !== "ACTIVE") return { kind: "TICKET_NOT_ACTIVE" as const };
			if (!target || target.status !== "AVAILABLE") return { kind: "SPOT_UNAVAILABLE" as const };
			if (target.id === ticket.spotId) return { kind: "SAME_SPOT" as const };
			if (target.type !== ticket.spot.type) return { kind: "TYPE_MISMATCH" as const };

			const claimed = await tx.spot.updateMany({ where: { id: target.id, status: "AVAILABLE" }, data: { status: "OCCUPIED" } });
			if (claimed.count !== 1) throw new Error("TARGET_SPOT_CLAIM_FAILED");
			const moved = await tx.ticket.updateMany({ where: { id: ticket.id, status: "ACTIVE", spotId: ticket.spotId }, data: { spotId: target.id } });
			if (moved.count !== 1) throw new Error("TICKET_REASSIGN_FAILED");
			await tx.spot.updateMany({ where: { id: ticket.spotId }, data: { status: "AVAILABLE" } });
			return { kind: "SUCCESS" as const, ticket: { ...ticket, spotId: target.id, spot: target } };
		});

		if (result.kind !== "SUCCESS") return Response.json({ error: result.kind }, { status: result.kind === "TICKET_NOT_ACTIVE" ? 404 : 409 });
		return Response.json({ success: true, ticket: result.ticket });
	} catch (error: unknown) {
		return Response.json({ error: error instanceof Error ? error.message : "Spot reassignment failed" }, { status: 400 });
	}
}