/* @refresh reload */
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import Root from "./root";
import "./index.css";

const root = document.getElementById("root");

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html?",
  );
}

render(
  () => (
    <Router>
      <Route path="/" component={Root} />
    </Router>
  ),
  root!,
);
