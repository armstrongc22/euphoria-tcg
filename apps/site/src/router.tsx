import { createBrowserRouter } from "react-router-dom";
import { Layout } from "./layout/Layout";
import { Home } from "./pages/Home";
import { Play } from "./pages/Play";
import { Cards } from "./pages/Cards";
import { Manga } from "./pages/Manga";
import { Shop } from "./pages/Shop";
import { Blog } from "./pages/Blog";
import { BlogPost } from "./pages/BlogPost";
import { MapPage } from "./pages/MapPage";
import { NotFound } from "./pages/NotFound";

/**
 * Single source of truth for the Euphoria Universe routes. The Layout renders
 * the shared nav/footer around an <Outlet/>; each route below is a placeholder
 * shell for now (the /play TCG board and the /map 3D scene come later).
 */
export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: "play", element: <Play /> },
      { path: "cards", element: <Cards /> },
      { path: "manga", element: <Manga /> },
      { path: "shop", element: <Shop /> },
      { path: "blog", element: <Blog /> },
      { path: "blog/:slug", element: <BlogPost /> },
      { path: "map", element: <MapPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
