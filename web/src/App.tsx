import { BrowserRouter, Route, Routes } from "react-router-dom";
import AppShell from "@/components/AppShell";
import Chat from "@/pages/Chat";
import Dashboard from "@/pages/Dashboard";
import Explore from "@/pages/Explore";
import NotFound from "@/pages/NotFound";
import Observability from "@/pages/Observability";
import Search from "@/pages/Search";
import Slides from "@/pages/Slides";

const App = () => (
  <BrowserRouter>
    <Routes>
      {/* Every page sits inside the one shell, so the navigation never moves between them. */}
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/search" element={<Search />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/observability" element={<Observability />} />
        <Route path="/slides" element={<Slides />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  </BrowserRouter>
);

export default App;
