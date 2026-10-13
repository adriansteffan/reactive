import React from "react";
import ReactDOM from "react-dom/client";
import Experiment from "./Experiment";
import "./index.css";
import { ExperimentProvider } from "@adriansteffan/reactive";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ExperimentProvider disableSettings={process.env.PUBLIC_DISABLE_SETTINGS} disableHybridSimulation={process.env.PUBLIC_DISABLE_HYBRID_SIMULATION}>
      <Experiment />
    </ExperimentProvider>
  </React.StrictMode>
);