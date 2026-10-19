import { Link } from "react-router-dom";
import SiteHeader from "@/components/SiteHeader";

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <h1 className="text-xl font-semibold tracking-tight">Nothing here</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          That address does not hold a page.{" "}
          <Link to="/" className="underline underline-offset-2">
            Go to Home
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
