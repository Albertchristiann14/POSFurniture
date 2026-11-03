import { NextResponse } from "next/server";
import { calculateInstallmentSchedule } from "@/modules/credit/calculator";
import { SimulationRequestSchema } from "@/modules/credit/validators";
import { bigIntReplacer } from "@/shared/math/currency";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const validated = SimulationRequestSchema.parse(body);

    const result = calculateInstallmentSchedule({
      itemTotalAmount: validated.itemTotalAmount,
      downPaymentAmount: validated.downPaymentAmount,
      tenorMonths: validated.tenorMonths,
      marginMethod: validated.marginMethod || "FLAT_MONTHLY",
      marginRateBps: validated.marginRateBps || 200,
      adminFeeAmount: validated.adminFeeAmount || 50000n,
    });

    // Serialisasi aman dengan bigIntReplacer
    const jsonString = JSON.stringify(
      {
        success: true,
        data: result,
      },
      bigIntReplacer
    );

    return new NextResponse(jsonString, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Terjadi kesalahan pada kalkulasi simulasi";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

