import { connection } from "next/server";
import { LIMITS, parseDeposit } from "@/lib/paths/protocol";
import { getStore } from "@/lib/paths/store";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  await connection();
  return Response.json(await getStore().read(), { headers: noStore });
}

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > LIMITS.maxBodyBytes) {
    return Response.json({ error: "too large" }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const deposit = parseDeposit(json);
  if (!deposit) {
    return Response.json({ error: "invalid deposit" }, { status: 400 });
  }

  await getStore().deposit(deposit);
  return Response.json({ ok: true }, { headers: noStore });
}
