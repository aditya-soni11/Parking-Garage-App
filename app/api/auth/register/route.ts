import bcrypt from "bcryptjs";
import { prisma } from "../../../../lib/prisma";

export async function POST(request: Request) {
	let body: unknown;

	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	if (
		typeof body !== "object" ||
		body === null ||
		typeof (body as { email?: unknown }).email !== "string" ||
		typeof (body as { password?: unknown }).password !== "string"
	) {
		return Response.json(
			{ error: "Email and password are required" },
			{ status: 400 },
		);
	}

	const email = (body as { email: string }).email.trim().toLowerCase();
	const password = (body as { password: string }).password;

	if (!email || password.length < 8) {
		return Response.json(
			{ error: "Use a valid email and a password of at least 8 characters" },
			{ status: 400 },
		);
	}

	const existingUser = await prisma.user.findUnique({ where: { email } });
	if (existingUser) {
		return Response.json({ error: "Email is already registered" }, { status: 409 });
	}

	const user = await prisma.user.create({
		data: { email, password: await bcrypt.hash(password, 12) },
		select: { id: true, email: true },
	});

	return Response.json(
		{ success: true, session: { userId: user.id, email: user.email } },
		{ status: 201 },
	);
}