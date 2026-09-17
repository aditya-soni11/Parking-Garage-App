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

	const { email, password } = body as { email: string; password: string };
	const user = await prisma.user.findUnique({
		where: { email: email.trim().toLowerCase() },
	});

	if (!user || !(await bcrypt.compare(password, user.password))) {
		return Response.json(
			{ error: "Invalid email or password" },
			{ status: 401 },
		);
	}

	return Response.json({
		success: true,
		session: { userId: user.id, email: user.email },
	});
}
