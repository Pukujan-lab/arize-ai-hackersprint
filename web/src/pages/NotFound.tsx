import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Nothing here</h1>
      <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
        That address does not hold a page. The workspace has a dashboard, a chat, a search over the authorities your
        runs hold, and the citation map.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to="/">Go to the dashboard</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to="/chat">Ask a question</Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to="/explore">Open the map</Link>
        </Button>
      </div>
    </div>
  );
}
