import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { QuorumMark } from "@/components/brand";
import { Btn } from "@/components/design";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 text-center">
      <QuorumMark size={36} className="text-bronze" />
      <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-faint-ink">404 · Empty chair</p>
      <h1 className="mt-3 font-display text-[38px] leading-tight text-ink">This room was never convened.</h1>
      <p className="mt-3 max-w-[380px] text-[13.5px] leading-relaxed text-muted-ink">
        The page you asked for is not on the agenda. Return to the boardroom and pick up the
        decision in progress.
      </p>
      <Link href="/" className="mt-7">
        <Btn variant="outline" size="md">
          <ArrowLeft className="h-4 w-4" /> Back to the boardroom
        </Btn>
      </Link>
    </div>
  );
}
