import React from "react";
import ReactDOM from "react-dom/client";
import experiment from "./Experiment";
import "./index.css";
import { ExperimentRunner } from "@adriansteffan/reactive";

// Kept across hot reloads, so that an edited experiment re-renders the one that is running.
// biome-ignore lint/suspicious/noAssignInExpressions: production builds replace this whole expression with the new root
const root = (import.meta.hot.data.root ??= ReactDOM.createRoot(document.getElementById("root")!));

function render(definition: typeof experiment) {
  root.render(
    <React.StrictMode>
      <ExperimentRunner
        experiment={definition}
        disableSettings={process.env.PUBLIC_DISABLE_SETTINGS}
        disableDev={process.env.PUBLIC_DISABLE_DEV}
      />
    </React.StrictMode>
  );
}

render(experiment);

// Re-rendering the same runner with the edited experiment keeps the participant's place
import.meta.hot.accept("./Experiment", (module) => {
  if (module) render(module.default);
});
