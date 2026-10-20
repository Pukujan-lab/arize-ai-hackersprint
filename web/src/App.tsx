import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppShell from "@/components/AppShell";
import { Toaster } from "@/components/ui/sonner";
import Chat from "@/pages/Chat";

const App = () => (
  <BrowserRouter>
    <Routes>
      {/* One page: ask, read the memo, and switch it to the map. The shell holds the history. */}
      <Route element={<AppShell />}>
        <Route path="/" element={<Chat />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    <Toaster position="bottom-right" />
  </BrowserRouter>
);

export default App;
