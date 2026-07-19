import { Outlet, ScrollRestoration } from "react-router-dom";
import { Nav } from "./Nav";
import { Footer } from "./Footer";

/** Shared chrome: top nav, the routed page via <Outlet/>, then the footer. */
export function Layout() {
  return (
    <div className="eu-shell">
      <a className="eu-skip" href="#main">
        Skip to content
      </a>
      <Nav />
      <main className="eu-main" id="main">
        <Outlet />
      </main>
      <Footer />
      <ScrollRestoration />
    </div>
  );
}
