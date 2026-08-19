import { readProductionTasteCount } from "@/lib/engine/stats";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const totalTastes = await readProductionTasteCount();
    return Response.json({ totalTastes });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not read taste count.";
    return Response.json({ error: message }, { status: 500 });
  }
}
