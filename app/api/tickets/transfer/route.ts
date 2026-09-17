import { prisma } from "../../../../lib/prisma";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as { currentPlate?: unknown }).currentPlate !== "string" ||
      typeof (body as { newPlate?: unknown }).newPlate !== "string"
    ) {
      return Response.json(
        { error: "Both currentPlate and newPlate are required." },
        { status: 400 },
      );
    }

    const currentPlate = (body as { currentPlate: string }).currentPlate
      .trim()
      .toUpperCase();
    const newPlate = (body as { newPlate: string }).newPlate.trim().toUpperCase();

    if (!currentPlate || !newPlate) {
      return Response.json(
        { error: "Both currentPlate and newPlate are required." },
        { status: 400 },
      );
    }

    if (currentPlate === newPlate) {
      return Response.json(
        { error: "Current plate and new plate cannot be identical." },
        { status: 400 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const activeTicket = await tx.ticket.findFirst({
        where: { plate: currentPlate, status: "ACTIVE" },
        include: { spot: true },
      });

      if (!activeTicket) {
        return { kind: "NOT_FOUND" as const };
      }

      const conflictingTicket = await tx.ticket.findFirst({
        where: { plate: newPlate, status: "ACTIVE" },
        select: { id: true },
      });

      if (conflictingTicket) {
        return { kind: "CONFLICT" as const };
      }

      const updatedTicket = await tx.ticket.updateMany({
        where: {
          id: activeTicket.id,
          plate: currentPlate,
          status: "ACTIVE",
        },
        data: { plate: newPlate },
      });

      if (updatedTicket.count !== 1) {
        throw new Error("TRANSFER_UPDATE_FAILED");
      }

      return {
        kind: "SUCCESS" as const,
        ticket: {
          ...activeTicket,
          plate: newPlate,
        },
      };
    });

    if (result.kind === "NOT_FOUND") {
      return Response.json(
        { error: `No active ticket found for plate: ${currentPlate}` },
        { status: 404 },
      );
    }

    if (result.kind === "CONFLICT") {
      return Response.json(
        { error: `Plate ${newPlate} already has an active session.` },
        { status: 409 },
      );
    }

    return Response.json({
      success: true,
      message: `Session transferred from ${currentPlate} to ${newPlate}.`,
      ticket: {
        id: result.ticket.id,
        plate: result.ticket.plate,
        previousPlate: currentPlate,
        spotNumber: result.ticket.spot.number,
        spotType: result.ticket.spot.type,
        entryTime: result.ticket.entryTime,
        status: result.ticket.status,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Ticket transfer failed";
    return Response.json({ error: message }, { status: 500 });
  }
}