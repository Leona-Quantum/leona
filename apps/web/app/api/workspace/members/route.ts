import { NextResponse } from "next/server";

export async function POST(request: Request) {
  void request;
  return NextResponse.json(
    { error: "workspace collaboration is deferred" },
    { status: 409 },
  );
}
