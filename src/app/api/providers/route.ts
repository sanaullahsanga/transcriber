import { NextResponse } from "next/server";
import { listProviders } from "@/lib/providers-config";

export async function GET() {
  return NextResponse.json({ providers: listProviders() });
}
